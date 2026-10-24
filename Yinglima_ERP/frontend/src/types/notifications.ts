export interface NotificationRule {
  id: string;
  event_key: string;
  title: string;
  description: string | null;
  module: string;
  role_ids: string[];
  user_ids: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  sender_id: string | null;
  type: string;
  module: string | null;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}
