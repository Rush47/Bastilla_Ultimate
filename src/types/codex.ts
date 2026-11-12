export interface CodexDeviceLogin {
  state: "starting" | "pending" | "complete" | "failed" | "cancelled" | "expired";
  verification_url?: string;
  user_code?: string;
  expires_at: number;
}

export interface CodexStatus {
  installed: boolean;
  version: string;
  binary_path: string;
  auth_ready: boolean;
  token_type: "CHATGPT" | "API_KEY" | "ACCESS_TOKEN" | "WORKLOAD_IDENTITY" | "NONE";
  login_status: "logged_in" | "not_logged_in" | "invalid_credentials" | "unavailable" | "error";
  has_auth_json: boolean;
  api_key_configured: boolean;
  message: string;
  login: CodexDeviceLogin | null;
}
