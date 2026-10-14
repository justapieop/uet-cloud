import { DefaultAzureCredential } from "@azure/identity";
import { Injectable } from "@nestjs/common";
import { KeyClient, type SignResult } from "@azure/keyvault-keys";
import { ConfigService } from "@nestjs/config";
import { runBuildStep } from "../build-errors.js";

export interface KeyOperationInput {
  data: string;
  keyName: string;
}

@Injectable()
export class KmsProvider {
  private readonly kmsClient: KeyClient;

  public constructor(configService: ConfigService) {
    const credentials: DefaultAzureCredential = new DefaultAzureCredential();

    const vault: string = configService.getOrThrow<string>("AZURE_VAULT_NAME");
    const vaultUrl: string = vault.startsWith("https://") ? vault : `https://${vault}.vault.azure.net`;
    this.kmsClient = new KeyClient(
      vaultUrl,
      credentials,
    );
  }

  public async sign(input: KeyOperationInput): Promise<string> {
    const res: SignResult = await runBuildStep("Key Vault JWT signing", () =>
      this.kmsClient.getCryptographyClient(input.keyName).signData("RS256", Buffer.from(input.data)),
    );

    return Buffer.from(res.result).toString("base64url");
  }
}
