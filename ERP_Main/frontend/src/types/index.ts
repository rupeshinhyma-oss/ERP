/**
 * TypeScript Interfaces for ERP_Main Control Plane.
 */

export type ErpStatus = "ACTIVE" | "INACTIVE" | "DECOMMISSIONED";
export type MembershipStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REVOKED";
export type GlobalUserStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";
export type ConflictStatus = "PENDING" | "RESOLVED" | "REJECTED";
export type ConflictType = "AMBIGUOUS_MATCH" | "CONFLICT";
export type ExportStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
export type AuthorizationScope = "GLOBAL" | "ERP";

export interface ErpInstance {
  id: string;
  erp_key: string;
  key?: string;
  name: string;
  display_name?: string;
  status: ErpStatus;
  version: string;
  base_url: string;
  description?: string | null;
  capabilities: string[];
  created_at: string;
  updated_at?: string;
}

export interface GlobalUser {
  id: string;
  display_name: string;
  primary_email: string;
  email?: string;
  status: GlobalUserStatus;
  is_active?: boolean;
  is_suspended?: boolean;
  suspension_reason?: string | null;
  external_identity_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string;
  memberships_count?: number;
}

export interface ErpMembership {
  id: string;
  global_user_id: string;
  erp_instance_id: string;
  local_user_id: string;
  status: MembershipStatus;
  linked_at?: string;
  verified_at?: string | null;
  last_seen_at?: string | null;
  created_at: string;
  updated_at?: string;
  user_email?: string;
  user_display_name?: string;
  erp_name?: string;
  erp_key?: string;
}

export interface PlatformRole {
  id: string;
  role_key: string;
  display_name: string;
  description?: string | null;
  is_active: boolean;
  permission_keys: string[];
  created_at: string;
  updated_at: string;
  role?: string;
  name?: string;
  permissions?: string[];
}

export interface PlatformPermission {
  id: string;
  permission_key: string;
  description?: string | null;
  created_at: string;
  key?: string;
  domain?: string;
}


export interface PlatformRoleAssignment {
  id: string;
  global_user_id: string;
  role_id: string;
  role_key: string;
  scope: AuthorizationScope;
  erp_instance_id?: string | null;
  is_active: boolean;
  assigned_by?: string | null;
  revoked_at?: string | null;
  revoked_by?: string | null;
  expires_at?: string | null;
  created_at: string;
}

export interface EffectivePermissions {
  global_user_id: string;
  global_permissions: string[];
  erp_permissions: Record<string, string[]>;
}

export interface IdentityConflict {
  id: string;
  erp_instance_id: string;
  local_user_id: string;
  normalized_email: string;
  status: ConflictStatus;
  conflict_type: ConflictType;
  candidate_global_user_ids: string[];
  details_json?: Record<string, unknown>;
  created_at: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_action?: string | null;
  erp_name?: string;
}

export interface PlatformAdmin {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  last_login_at?: string | null;
  created_at: string;
}

export interface GlobalAuditEvent {
  id: string;
  event_type: string;
  actor_type: "HUMAN_ADMIN" | "ERP_SERVICE" | "SYSTEM" | string;
  actor_id?: string | null;
  actor_label?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
  // Optional convenience fields:
  occurred_at?: string;
  action?: string;
  actor_email?: string;
  status?: "SUCCESS" | "FAILURE" | "DENIED" | string;
  ip_address?: string | null;
  erp_name?: string | null;
}

export type InboxEventStatus = "RECEIVED" | "ROUTED" | "IGNORED" | "FAILED" | "DEAD_LETTER";

export interface IntegrationInboxEvent {
  id: string;
  event_id: string;
  event_type: string;
  event_version: number;
  source_erp_id: string;
  source_entity_type: string;
  source_entity_id: string;
  correlation_id: string;
  causation_id?: string | null;
  status: InboxEventStatus;
  routed_to: string[];
  attempt_count: number;
  last_error?: string | null;
  created_at: string;
  payload?: Record<string, unknown> | null;
}

export interface IntegrationDeadLetter {
  id: string;
  inbox_event_id: string;
  event_id: string;
  event_type: string;
  source_erp_id: string;
  attempt_count: number;
  last_error: string;
  failed_at: string;
  replayed_at?: string | null;
  replayed_by?: string | null;
}

export type IntegrationTargetKind = "SPECIFIC_ERP" | "BROADCAST";

export interface IntegrationSubscription {
  id: string;
  event_type: string;
  source_erp_id: string;
  target_kind: IntegrationTargetKind;
  target_erp_id?: string | null;
  required_capability?: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReconciliationResult {
  erp_id: string;
  erp_key: string;
  projection_count: number;
  outbox_published_count?: number | null;
  status: "MATCHED" | "RECONCILIATION_REQUIRED" | "UNKNOWN" | string;
}

export interface IntegrationStats {
  total_inbox_events: number;
  processed_inbox_events: number;
  failed_inbox_events: number;
  total_outbox_events: number;
  published_outbox_events: number;
  failed_outbox_events: number;
}

export interface ErpHealth {
  erp_id: string;
  erp_key: string;
  display_name: string;
  status: string;
  last_seen_at: string | null;
  api_health: "HEALTHY" | "STALE" | "UNKNOWN" | string;
  enabled_capabilities: string[];
  buyer_projection_count: number;
}

export interface ProjectionHealth {
  projection_type: string;
  last_processed_at: string | null;
  events_processed_count: number;
  error_count: number;
  last_error: string | null;
  lag_seconds: number | null;
}

export interface GlobalDashboard {
  active_erps: number;
  total_erps: number;
  global_users: number;
  active_memberships: number;
  events_received_total: number;
  events_dead_lettered_total: number;
  erp_health: ErpHealth[];
  projection_health: ProjectionHealth[];
  data_as_of: string;
}

export interface GlobalBuyerProjection {
  id: string;
  source_erp_id: string;
  source_entity_type: string;
  source_entity_id: string;
  company_name: string;
  status: string | null;
  synced_at: string;
}

export interface GlobalBuyerProjectionDetail extends GlobalBuyerProjection {
  last_event_id: string;
  last_event_occurred_at: string;
  created_at: string;
  updated_at: string;
}

export interface ReportDefinition {
  report_key: string;
  name: string;
  description: string;
  entity_type: string;
  supported_formats: string[];
  supported_filters: string[];
  status: "AVAILABLE" | "NOT_YET_SUPPORTED" | string;
  is_available: boolean;
}

export interface GenericSearchResult {
  id: string;
  entity_type: string;
  display_title: string;
  display_subtitle?: string;
  source_erp_id: string;
  source_entity_id: string;
  status: string | null;
  synced_at: string;
  raw_data: Record<string, unknown>;
}

export interface SearchResponse {
  results: GlobalBuyerProjection[];
  total: number;
  limit: number;
  offset: number;
  data_as_of: string;
}

export interface ExportJob {
  id: string;
  report_type: string;
  export_format: "csv" | "xlsx" | string;
  status: ExportStatus;
  row_count: number | null;
  error_message: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ApiResponse<T> {

  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  request_id?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page?: number;
  limit?: number;
  offset?: number;
}

export interface PaginationMeta {
  current_page?: number;
  total_pages?: number;
  total_records?: number;
  total_items?: number;
  page_size?: number;
  has_previous?: boolean;
  has_next?: boolean;
}

export interface TokenPair {
  access_token: string;
  expires_at?: string;
}

export interface GlobalUserProfile {
  id: string;
  display_name: string;
  primary_email: string;
  status: string;
}

export interface GlobalLoginResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  session_id: string;
}

export interface GlobalSessionRead {
  id: string;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at: string;
  expires_at: string;
  revoked_at?: string | null;
}

export interface FederationClientRead {
  id: string;
  erp_instance_id: string;
  client_id: string;
  redirect_uris: string[];
  federation_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthorizeRequest {
  erp_instance_id: string;
  redirect_uri: string;
  state: string;
  nonce?: string;
  code_challenge?: string;
  code_challenge_method?: "S256";
}

export interface AuthorizeResponse {
  authorization_code: string;
  state: string;
  redirect_uri: string;
}

export type PrincipalType = "global_user" | "platform_admin";

export interface SessionState {
  isAuthenticated: boolean;
  currentUser: GlobalUserProfile | PlatformAdmin | null;
  userType: PrincipalType | null;
  memberships: ErpMembership[];
  loading: boolean;
  sessionExpired: boolean;
  isSuperAdmin: boolean;
}
