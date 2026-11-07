# CPU Scale Rule / Auto Scaling

## Hiện trạng và phạm vi

Triển khai trên `dev`, checkout sạch trước khi sửa, remote local `justapieop/uet-cloud` (khác `dzadanh/uet-cloud` trong yêu cầu). Dự án đã có NestJS với các layer domain/application/infrastructure/presentation, TypeORM/SQL Server, Azure Container Apps (ACA), min/max scaling trong creation request, Azure Monitor, Stripe admission, SQL deployment operation lease và worker polling. Chưa có model/API/evaluation engine cho scale rule hay thao tác thay đổi replica có xác nhận readiness.

Mỗi deployment có tối đa **một CPU policy**, định danh bằng deployment UUID. Owner vẫn thuộc deployment; replica/configuration thực tế vẫn đọc từ Azure, không thêm desired/actual replica count vào SQL. RAM không phải metric điều khiển trong phiên bản này. Không thêm dependency npm, monitoring, scheduler framework, pipeline hay biến môi trường mới.

## Kiến trúc và semantics

1. API dùng session/permission guard hiện có; application kiểm tra ownership. `ManageScaleRuleCase` dùng cùng SQL lease với attach/detach/delete/evaluation và validation của `ScaleRule` domain.
2. Lưu rule bằng repository trong `UnitOfWork`. Khi bật rule, đọc active subscriptions từ Stripe **ngoài transaction**, rồi khóa user trong transaction, kiểm tra lại billing association, reservation và quota của một plan. Disable/delete không cần subscription.
3. `ScaleRuleWorker` tái sử dụng `QueuePollingPolicy`: tối đa một evaluation đang chạy mỗi API process, backoff khi idle và chờ active operation khi shutdown. `claimNextDue()` dùng atomic SQL `UPDLOCK/READPAST/READCOMMITTEDLOCK`, đưa checkpoint sang 60 giây tiếp theo. Các API replica phối hợp qua SQL, không có worker riêng cho từng rule.
4. Application lấy lease deployment, đọc lại rule, user active/unsuspended, trạng thái RUNNING và các quyền read/update/metrics hiện tại của owner. Adapter đọc replica/revision readiness; metrics đọc qua `AzureMonitorMetricsReader` hiện có, không qua cache HTTP.
5. Hàm thuần `evaluateScaleRule()` trả `SCALE_OUT`, `SCALE_IN` hoặc `NO_ACTION`. Khi có action, kiểm tra lại Stripe/quota, user và deployment; claim `RUNNING -> SCALING` bằng conditional update trong transaction ngắn.
6. `AzureDeploymentScaler` đọc lại revision/replica set để phát hiện thay đổi, PATCH live template bằng SDK client được inject. ACA quản lý scheduling, readiness và traffic. Chỉ khi revision mới healthy/ready, nhận 100% traffic và có đúng số replica với containers started/ready, mới commit RUNNING và `last_scaled_at` cùng nhau.

CPU lấy từ `UsageNanoCores / 1e9`, đúng đơn vị **cores** của monitoring. Mỗi bucket một phút: `CPU% = mean(cores của mọi replica hiện tại) / vCPU mỗi replica * 100`. Không coi raw cores là phần trăm hoặc cộng phần trăm theo số replica. Utilization được phép vượt 100 nếu upstream thực sự đo như vậy.

Engine yêu cầu **mọi bucket** trong cửa sổ đều vượt ngưỡng tương ứng, thay vì chỉ lấy trung bình cả cửa sổ hoặc một spike. Bỏ một phút hoàn chỉnh mới nhất để chờ ingestion: lúc 10:10:30 với window 120 giây, cần bucket 10:07 và 10:08. Mỗi bucket phải có đúng một điểm hữu hạn, không âm, cho từng replica live và một replica-count series của revision đó bằng snapshot. Missing/null/stale/duplicate data, replica mới hoặc count thay đổi giữ nguyên capacity. Dữ liệu revision cũ không gộp vào revision hiện tại. Sau sửa rule/start/redeploy/scale, chờ đủ window mới ổn định.

## API và validation

API dùng `connect.sid`, UUID validation, Nest exceptions, snake_case DTO và `private, no-store`:

- `GET /deployments/:id/scale-rules`: 200, mảng rỗng hoặc một rule; không cần pagination vì tối đa một rule.
- `GET /deployments/:id/scale-rule`: 200 hoặc 404 nếu chưa có.
- `POST /deployments/:id/scale-rule`: 201; 409 nếu đã tồn tại.
- `PATCH /deployments/:id/scale-rule`: 200; `{ "enabled": false }` hoặc `true` để pause/enable.
- `DELETE /deployments/:id/scale-rule`: 204, idempotent khi rule đã vắng mặt.

Read yêu cầu DeploymentRead; create/update yêu cầu thêm DeploymentUpdate và DeploymentMetricsRead; delete yêu cầu thêm DeploymentUpdate. Super vẫn phải sở hữu deployment. Foreign/missing deployment trả 404 trước Stripe/Azure. Unknown body fields, null values và thay đổi binding/metadata bị chặn. Invalid data dùng 400, thiếu quyền/subscription dùng 403, conflict/quota/busy dùng 409, lỗi xác minh subscription dùng 503.

Body tạo rule đầy đủ; `enabled` phải được gửi rõ ràng để opt in:

```json
{
  "enabled": true,
  "metric": "cpu",
  "scale_out_threshold": 80,
  "scale_in_threshold": 20,
  "min_replicas": 1,
  "max_replicas": 2,
  "evaluation_window_seconds": 120,
  "cooldown_seconds": 300
}
```

- `0 <= scale_in_threshold < scale_out_threshold <= 100`.
- `1 <= min_replicas <= max_replicas <= 1000`, nằm trong min_scaling/max_scaling đã reserve; rule không mở rộng reservation.
- Window 120–1800 giây, chia hết cho 60; cooldown 60–86400 giây từ **hoàn tất thành công**.
- Một active Stripe-linked plan phải bao phủ saved CPU/RAM/max scaling và deployment slots; khi scale cũng kiểm tra CPU/RAM live. Không cộng quota nhiều plan.
- Response có last_evaluated_at, last_scaled_at, last_action, last_reason, created_at, updated_at; không có credential/polling checkpoint.

Mission Control có card CPU auto scaling để tạo/sửa, enable/pause, delete và refresh. Server Actions dùng cookie và generated `@kumo/rest`, theo Feature-Sliced Design và style hiện có.

## ACA và giới hạn cần biết

ACA không có desired-count setter giống Kubernetes. Adapter thực hiện step scaling bằng `minReplicas = maxReplicas = target`, giữ nguyên live containers, env references, probes, volumes và phần còn lại của template; không round-trip configuration/secrets/identities. Template change tạo revision mới và dùng rollout/traffic của ACA. Chỉ hỗ trợ app single revision, một container, ingress/FQDN, không có custom native scale rules, revision healthy nhận 100% traffic và ít nhất một replica ready. App không đáp ứng điều kiện chỉ ghi lý do, không gửi PATCH.

Khi capacity trong bounds, mỗi lần tăng/giảm một replica. Khi drift ra ngoài, một quyết định hợp lệ đưa target về bound tương ứng. Không ép capacity khi thiếu metrics hoặc CPU giữa hai ngưỡng. Trước **action đầu tiên**, min/max và default HTTP scaling đang có trên ACA vẫn hiệu lực; phải giữ ít nhất một replica running và nên pin baseline khi demo CPU policy. Sau action, applied min/max bằng target, khác reservation gốc trong SQL. Disable/delete giữ nguyên applied count, không restore native bounds. Deployment không có rule giữ nguyên hành vi.

CPU policy không scale-to-zero, không đánh thức app đang ở 0 và không bật lại STOPPED app. Multi-revision traffic splitting, sidecar aggregation, RAM policy và tự restore native bounds ngoài phạm vi hiện tại. Rollout/maintenance có thể tạm giữ cả replica cũ và mới; max là target, không phải cam kết trần tuyệt đối của pod chuyển tiếp do Azure sử dụng.

SCALING reserve deployment slot và chặn start/stop/redeploy/delete/volume operations bằng lease hoặc conditional lifecycle transitions hiện có. Không giữ transaction lúc gọi Stripe/Monitor/ARM hoặc chờ rollout. Provider failure/timeout/không xác nhận readiness đặt FAILED, không cập nhật successful cooldown. Stale sweep fail scaling gián đoạn sau `AZURE_DEPLOYMENT_TIMEOUT_MS + 60 giây`, **không gửi lại cloud write**. Log chỉ chứa deployment/rule UUID, metric, decision, target, reason và kết quả an toàn.

ARM write có thể thành công dù mất response; SQL lease không hủy/fence được thao tác Azure đã được chấp nhận hoặc thay đổi ngoài Kumo. Khi FAILED, operator kiểm tra revision đang nhận traffic, số replica, readiness và error ở Azure trước khi dùng endpoint redeploy hiện có để phục hồi. Không sửa SQL thành RUNNING khi chưa xác nhận cloud. Không retry toàn bộ workflow.

Tham khảo [ACA scaling](https://learn.microsoft.com/azure/container-apps/scale-app), [revision readiness/traffic](https://learn.microsoft.com/azure/container-apps/revisions), [RBAC operations](https://learn.microsoft.com/azure/role-based-access-control/permissions/compute).

## Migration và cấu hình

Migration append-only `ScaleRules1794009600000` trong db/migrations.ts tạo scale_rules, PK/FK deployment_id, index enabled/due và CHECK constraints cho metric/threshold/bounds/duration/action. Hard deletion cascade; soft deletion qua use case xóa rule cùng UoW với acceptance. Không sửa/copy ownership/replica count của deployment. Dùng startup migration registration hiện có; compile không apply migration. Dừng workers trước rollback; down migration xóa bảng policy mới.

Runtime IAM trong infra/azure/iam.bicep bổ sung `Microsoft.App/containerApps/revisions/read` và `Microsoft.App/containerApps/revisions/replicas/read`, ngoài containerApps read/write và metrics/read hiện có. Operator apply theo [azure-iam.md](azure-iam.md); source/compile không đồng nghĩa quyền đã được cấp. Adapter dùng shared workload scope và injected ContainerAppsAPIClient; MonitoringModule export reader hiện có cho DeploymentModule. Timeout vẫn dùng AZURE_DEPLOYMENT_TIMEOUT_MS; platform API cần replica luôn chạy để worker hoạt động.

## Files để review

- Domain: scale-rule.ts, deployment.ts và index.ts: policy validation, SCALING và public exports.
- Application: ports/scale-rule.ts, ports/uow.ts, ports/deployment-operation-lock.ts, public exports; use-cases/deployment/{ManageScaleRule.case.ts,EvaluateScaleRule.case.ts,evaluate-scale-rule.ts,scale-rule-capacity.ts,DeleteDeployment.case.ts,index.ts}.
- Infrastructure persistence: db/repositories/{scale-rule.ts,deployment.ts}, db/{uow.ts,migrations.ts,index.ts}: due claim, reservation, stale recovery, migration/UoW.
- Azure: azure/{deployment-scaler.ts,scale-rule-worker.ts,deployment-configuration.ts,index.ts}: scaling, polling, shared RAM normalization.
- Presentation: controllers/ScaleRules.controller.ts, dto/{ScaleRule.dto.ts,Deployment.dto.ts,ListDeploymentsQuery.dto.ts}, modules/{Deployment.module.ts,Database.module.ts,Monitoring.module.ts}.
- Frontend: features/manage-scale-rule/{model/types.ts,api/actions.ts,ui/scale-rule-card.tsx,ui/scale-rule-editor.tsx,index.ts}; entities/deployment/model/types.ts; views/dashboard/ui/dashboard-page.tsx; views/mission-control/ui/{mission-control-page.tsx,overview-header.tsx}.
- Generated packages/rest/src/schema.ts: sinh lại từ OpenAPI controller metadata bằng openapi-typescript; không sửa types tay.
- Tests: domain/application scale-rule.test.ts; infrastructure deployment-scaler.test.ts, scale-rule-migration.test.ts, uow.test.ts và hai SQL integration suites; presentation scale-rules.test.ts/openapi.test.ts; application admission/redeploy/deployment regressions và repository helpers.
- Docs: tài liệu này, reliability/testing/provider-dependencies và product brief; IAM chỉ thêm hai quyền đọc cần cho readiness.

## Kiểm thử tự động

```powershell
npm.cmd run test:api
npm.cmd run build -w apps/web
az bicep build --file infra/azure/iam.bicep --outfile .temp/iam-scale-rule.json
npm.cmd run test:db
```

test:api bao gồm backend build, test typecheck và các suite Node/Python. Metrics/Stripe/ARM được mock tại external boundary; HTTP tests dùng controller/guard/validation/serialization và management use case thật. Repo không có lint command riêng. SQL suite cần instance test riêng và TEST_SQLSERVER_PASSWORD, tự tạo/xóa database ngẫu nhiên, bật READ_COMMITTED_SNAPSHOT và chạy migrations thật; không đọc DB trong .env. Thiếu credentials thì fail thay vì giả pass. Xem [testing.md](testing.md).

Kết quả phiên triển khai: test:api **355 Node tests + 6 Python tests pass**; frontend production build pass; IAM Bicep compile pass. SQL Server driver cũng sinh DDL migration thành công trong SQL-memory mode, không kết nối DB. test:db dừng vì thiếu TEST_SQLSERVER_PASSWORD; Docker daemon không chạy. Chưa apply migration vào DB hiện có hoặc chạy scale với Azure thật. Compile/typecheck/SQL-memory không chứng minh SQL concurrency, DDL hay cloud readiness đã được xác minh live.

## Demo local với Azure thật

Backend/web chạy local, workload vẫn trên ACA; repo không có local orchestrator tương đương. Không dùng mock metrics trong production.

1. `npm.cmd ci`; cấu hình local theo [configuration.md](configuration.md), `az login`, chuẩn bị SQL/Redis và user có active plan với max_replicas >=2. Operator apply hai IAM read permissions trước khi chạy.
2. Chạy `npm.cmd run build:api`, `npm.cmd run start:api`, `npm.cmd run dev:web`. Đăng nhập frontend, tạo deployment min_scaling=1, max_scaling=2, CPU/RAM phù hợp plan và một endpoint thực hiện CPU work trong workload của bạn. Chờ RUNNING/healthy và có metrics thật.
3. Để default HTTP scaler không tự tăng trước CPU policy, operator chuẩn bị baseline demo: `az containerapp update --resource-group user-rg-<userId> --name <appName> --min-replicas 1 --max-replicas 1`. Giữ SQL creation reservation max_scaling=2; không sửa database. Chờ revision mới ready. Đây là lệnh để người vận hành chạy, agent chưa thực hiện.
4. Mở `/dashboard/deployments/<uuid>`, tạo rule từ body mẫu (80/20, 1–2 replicas, window120, cooldown300) và bật enabled. Hoặc gọi API với session cookie; GitHub access token không phải session.
5. Dùng công cụ load test của bạn gửi tải tới **CPU-heavy route của workload**. Giữ tải đến khi GET /deployments/<uuid>/metrics?range=1h cho thấy mọi bucket mean CPU >80% allocation ít nhất hai phút. Cộng thời gian ingestion, warm-up, polling và rollout; một request/spike ngắn không đủ.
6. Refresh rule/deployment. Quan sát RUNNING -> SCALING -> RUNNING, last_action=SCALE_OUT, last_scaled_at chỉ sau readiness, applied min/max=2; Portal > Revision management/Replicas/Metrics xác nhận hai replicas ready và revision mới nhận 100% traffic. Thiếu data/quota thì xem last_reason/worker log, không kỳ vọng fake scale.
7. Dừng tải, đợi cooldown và metrics của revision mới đủ window. Mean CPU <20% ở mọi bucket sẽ cho SCALE_IN, min/max=1 và một replica ready. Không dừng replica cuối.
8. Pause rồi gửi tải: worker không đổi count. Enable lại chờ window mới. Thử invalid thresholds, max vượt reservation, tài khoản khác, đồng thời stop/redeploy, và DELETE deployment để kiểm tra ownership/conflict/cleanup. Mutation thắng race được chấp nhận; mutation thua trả conflict.

Live CPU behavior, readiness/routing, billing, Azure quota và SQL integration chỉ được coi là xác minh sau khi chạy với hạ tầng thật. Task này không tự gửi tải, deploy IAM, commit hoặc push.
