export interface DeployConfig {
  // Meta / Instagram credentials (from user input)
  metaAppId: string;
  metaAppSecret: string;
  metaAccessToken: string;
  metaVerifyToken: string;
  igUserId: string;

  // Generated during setup
  apiKey: string;
  d1DatabaseId: string;
  d1DatabaseName: string;
  workerName: string;
  workerUrl: string;
  adminProjectName: string;
  adminUrl: string;
}
