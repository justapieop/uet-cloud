# Backend Monitoring API cho teammate frontend

`GET /deployments/{deployment_uuid}/metrics?range=1h` đọc Azure Monitor của Container App thuộc người dùng đang đăng nhập bằng session cookie. `range` chỉ nhận `1h`, `6h`, `24h`; mặc định `1h`. Backend đọc `Deployment.resourceId`, không nhận Azure resource ID từ client. Chỉ deployment `RUNNING` có resource ID hợp lệ được truy vấn.

Ví dụ:

```http
GET /deployments/a0000000-0000-4000-8000-000000000001/metrics?range=1h
Cookie: connect.sid=...
```

```json
{
  "deployment_id": "a0000000-0000-4000-8000-000000000001",
  "interval_seconds": 60,
  "aggregation": "Average",
  "cpu_unit": "cores",
  "memory_unit": "MiB",
  "cpu": [{
    "revision_name": "my-app--rev1",
    "replica_name": "my-app--rev1-pod1",
    "points": [{ "timestamp": "2026-10-17T08:00:00.000Z", "value": 0.15 }]
  }],
  "memory": [{
    "revision_name": "my-app--rev1",
    "replica_name": "my-app--rev1-pod1",
    "points": [{ "timestamp": "2026-10-17T08:00:00.000Z", "value": 220.5 }]
  }],
  "replicas": [{
    "revision_name": "my-app--rev1",
    "replica_name": null,
    "points": [{ "timestamp": "2026-10-17T08:00:00.000Z", "value": 1 }]
  }]
}
```

Đây là dữ liệu minh họa. `cpu` và `memory` là chuỗi **theo từng replica**; `replicas` là chuỗi **theo từng revision**. `Average` là trung bình của metric trong mỗi khoảng một phút cho chính chuỗi đó. Không cộng các chuỗi CPU/RAM hay coi giá trị trên là tổng toàn app. Replica count có thể là số thập phân nếu số replica thay đổi trong khoảng lấy trung bình. CPU lấy từ `UsageNanoCores / 1,000,000,000`; RAM lấy từ `WorkingSetBytes / 1,048,576`; replica count lấy từ `Replicas`. Đây là mức sử dụng thực tế, khác với CPU/RAM và min/max replicas đã cấu hình.

`points` có UTC timestamp. `value: null` nghĩa là bucket có timestamp nhưng Azure không có mẫu đo; mảng `cpu`, `memory` hoặc `replicas` rỗng nghĩa là Azure chưa trả chuỗi nào cho metric đó. `replicas.value: 0` chỉ xuất hiện khi Azure thực sự phát ra số 0 (scale-to-zero); không suy diễn số 0 từ dữ liệu trống. UI nên thể hiện trạng thái thiếu dữ liệu riêng. UI nên refresh không nhanh hơn **60 giây**, vì Azure cung cấp time grain `PT1M`. Backend có Redis cache riêng cho monitoring trong 60 giây, theo user, deployment và range. HTTP response vẫn là `Cache-Control: private, no-store`.

| HTTP | Ý nghĩa |
| --- | --- |
| 400 | UUID, `range` hoặc query parameter không hợp lệ. |
| 403 | Chưa đăng nhập hoặc user bị suspended (theo guard hiện có của Kumo). |
| 404 | Deployment không tồn tại hoặc không thuộc user. |
| 409 | Deployment chưa `RUNNING`, đã xóa, thiếu resource ID hoặc ID lưu trong DB không khớp tài nguyên Kumo của user. |
| 502 | Azure Monitor từ chối quyền đọc hoặc trả metric có cấu trúc/đơn vị bất thường. |
| 503 | Azure Monitor throttling (429) hoặc tạm thời không khả dụng (5xx/network). |

Backend dùng `DefaultAzureCredential` và `AZURE_SUBSCRIPTION_ID`. Identity của backend cần quyền `Microsoft.Insights/metrics/read` trên Container Apps được giám sát; vai trò **Monitoring Reader** ở phạm vi phù hợp là một cách cấp quyền. Không cấp Azure token cho frontend. Thử nghiệm local: đặt `CONFIG_SOURCE=local` cùng cấu hình API/DB/Redis hiện có, `az login`, chạy `npm.cmd install`, `npm.cmd run build:api`, `npm.cmd run start:api` trong PowerShell, đăng nhập Kumo, lấy UUID từ `GET /deployments`, gọi endpoint trên bằng session cookie và đối chiếu Azure Portal > Container App > Metrics với cùng range, `Average`, time grain 1 phút và cùng dimension. Quyền đọc Azure và metric thật chưa được xác nhận nếu không có Container App/credential live.

OpenAPI được NestJS tạo tại `/api-docs-json`. Khi API và các dịch vụ phụ thuộc chạy, tạo lại `@kumo/rest` bằng `npm.cmd run generate -w packages/rest -- http://localhost:3000/api-docs-json`, kiểm tra diff `packages/rest/src/schema.ts`, rồi để teammate frontend cập nhật client theo contract đó. Không sửa `apps/web` trong task này.
