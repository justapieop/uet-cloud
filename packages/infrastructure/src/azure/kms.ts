import { Injectable } from "@nestjs/common";
import type { KeyClient, SignResult } from "@azure/keyvault-keys";
import { runBuildStep } from "../build-errors.js";

export interface KeyOperationInput {
  data: string;
  keyName: string;
}

@Injectable()
export class KmsProvider {
  public constructor(private readonly kmsClient: Pick<KeyClient, "getCryptographyClient">) {}

  public async sign(input: KeyOperationInput): Promise<string> {
    const res: SignResult = await runBuildStep("Key Vault JWT signing", () =>
      this.kmsClient.getCryptographyClient(input.keyName).signData("RS256", Buffer.from(input.data)),
    );

    return Buffer.from(res.result).toString("base64url");
  }
}
