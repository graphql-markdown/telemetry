# Bootstrap

Creates the R2 bucket `gqlmd-telemetry-tfstate` that holds the remote state of `infra/`. It uses **local state** and is run once, by hand.

## One-time steps

1. Create a Cloudflare API token with `Workers R2 Storage: Edit` on the account.
2. Run:

   ```sh
   cd infra/bootstrap
   export TF_VAR_account_id=<account id>
   export TF_VAR_cloudflare_api_token=<token>
   tofu init
   tofu apply
   ```

3. Create an R2 API token (S3 credentials) scoped to this bucket, with Object Read & Write.
4. Store these as GitHub repository secrets and use them to configure the root module backend: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (the R2 credentials) and `TOFU_STATE_PASSPHRASE` (a long random passphrase, also kept in a password manager: losing it makes the state unreadable).
5. Keep `terraform.tfstate` here out of git (it is ignored). It only describes the bucket and can be re-imported if lost.
