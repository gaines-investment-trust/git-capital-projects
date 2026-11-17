# Setup and deployment runbook

Owner: Joe Gerber (COO). Built and supported by Claude under Joe's direction.

## What exists today (2026-11-16)

| Item | Value |
| --- | --- |
| Entra tenant | Gaines Investment Trust, `6cbf8d55-4474-4ef5-85d7-d5144d970539` |
| App registration | **GIT Capital Projects Platform**, client ID `0fc09c94-b943-468b-8642-4616315e435c`, owner Joe |
| Graph permissions configured | Delegated: User.Read, User.ReadBasic.All, Mail.Send, Calendars.ReadWrite, openid, profile, email, offline_access. Application: Sites.Selected, User.Read.All, GroupMember.ReadWrite.All, Mail.Read (**admin consent pending, IT request sent from Joe's Outlook**) |
| Azure subscription | `800b428f-7b39-4215-ab18-4cb8b9b363b3`. Joe is Contributor on `rg-joeg-sandbox` only |
| Main folder | `GIT Project Management Claude Platform` in the **gainescorp** OneDrive (`gaines-my.sharepoint.com/personal/gainescorp_gaines_onmicrosoft_com`), shared to Joe as "Gaines Corp's files - FileServer1". Drive `b!A1NLSZe1ZkK5QwrXZDNALHh5J1PgPGZLvpJgaDvCnZPgZHUClmbgSq5SL2o30ovp`, item `016VWGM5LMN6VZCHNETJGKSYDS47UAALQH` |

## Waiting on IT (draft email in Joe's Outlook)

1. Admin consent for the four application permissions.
2. `Sites.Selected` **Write** grant for the app on the gainescorp OneDrive site.
3. Resource group `rg-git-capital-projects` (West US 3) with Joe as **Owner**.
4. Later: `capex@` shared mailbox and an Exchange application access policy.

## First deployment (after item 3)

1. **App secret.** Entra ID › App registrations › GIT Capital Projects Platform › Certificates & secrets › New client secret, 24 months. Copy the value once; it goes straight into Key Vault in step 3 and nowhere else.
2. **Infrastructure.** In Azure Cloud Shell (Bash), from a clone of this repository:
   ```
   az deployment group create -g rg-git-capital-projects -f infra/main.bicep \
     -p adminObjectId=$(az ad signed-in-user show --query id -o tsv)
   ```
   This first run uses a placeholder image. Note the outputs: `appUrl`, `signInRedirectUri`, `acrName`, `keyVaultName`.
3. **Store the secret.** `az keyvault secret set --vault-name <keyVaultName> -n entra-client-secret --value '<secret from step 1>'`
4. **Sign-in address.** App registration › Authentication › add the Web redirect URI from `signInRedirectUri`.
5. **Deployment identity for GitHub** (no stored passwords):
   ```
   az ad app create --display-name "GIT CPP GitHub Deploy"            # note appId
   az ad sp create --id <appId>
   az ad app federated-credential create --id <appId> --parameters '{"name":"github-main","issuer":"https://token.actions.githubusercontent.com","subject":"repo:<owner>/git-capital-projects:environment:production","audiences":["api://AzureADTokenExchange"]}'
   RG=$(az group show -n rg-git-capital-projects --query id -o tsv)
   az role assignment create --assignee <appId> --role Contributor --scope $RG
   az role assignment create --assignee <appId> --role "Role Based Access Control Administrator" --scope $RG
   ```
6. **GitHub repository variables** (Settings › Secrets and variables › Actions › Variables): `AZURE_DEPLOY_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP=rg-git-capital-projects`, `AZURE_ACR_NAME`, `AZURE_ADMIN_OBJECT_ID`. Create an environment named `production`, with Joe as required reviewer.
7. Push to `main`. The pipeline tests, builds the image in Azure, applies the template with the new image, runs migrations and checks `/api/health`.
8. Open `appUrl` and sign in with Microsoft. The first sign-in by joeg@ becomes Executive + Admin. Add properties, then people.

## Local development

```
cp .env.example .env.local   # then set DATABASE_URL to a local PostgreSQL 16
npm ci && npm run migrate && npm run dev
```
`AUTH_DEV_LOGIN=1` allows a no-password sign-in **only** when NODE_ENV is not production; it is never set in Azure.

Tests: `TEST_DATABASE_URL=postgres://user:pass@localhost:5432/gcp_test npm test` (wipes and rebuilds that database).
Browser smoke test: `npm run dev` then `node e2e/smoke.mjs`.

## Operating

- Health: `GET /api/health`.
- Logs: Log Analytics workspace `gitcpp-prod-logs`, Application Insights `gitcpp-prod-ai`.
- Backups: PostgreSQL point-in-time restore, 35 days. Documents are in SharePoint with version history.
- Roll back: in Container Apps › gitcpp-prod-web › Revisions, activate the previous revision.
- Rotate the app secret before it expires: new secret, update `entra-client-secret` in Key Vault, restart the revision.
