export interface TechnicalTask {
  id: string;
  company_name: string;
  task_type: string;
  city: string;
  third_party?: string | null;
  third_party_city?: string | null;
  third_party_contact_name?: string | null;
  third_party_contact_phone?: string | null;
  priority: string;
  machine_model: string;
  task_description: string;
  contact_person_name?: string | null;
  contact_designation?: string | null;
  contact_phone?: string | null;
  created_by_name: string;
  task_created_date: string;
  creator_remarks?: string | null;
  service_type: string;
  service_charge?: number | null;
  payment_terms?: string | null;
  call_type: string;
  task_approved_by?: string | null;
  task_approved_date?: string | null;
  task_allotted_to?: string | null;
  approver_remarks?: string | null;
  scheduled_visit_date?: string | null;
  payment_status?: string | null;
  payment_mode?: string | null;
  payment_screenshot?: string | null;
  status: string;
  cancel_remarks?: string | null;
  completed_date?: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TechnicalTaskCallLog {
  id: string;
  task_id: string;
  call_date: string;
  call_type: string; // "Telecall" | "Physical Visit"
  remarks: string;
  created_by: string;
  created_at: string;
}

export interface TechnicalTaskCounts {
  all: number;
  pending: number;
  approved: number;
  payment_pending?: number;
  completed: number;
  cancel: number;
}

export interface TechnicalTaskCreatePayload {
  company_name: string;
  task_type?: string;
  city: string;
  third_party?: string | null;
  third_party_city?: string | null;
  third_party_contact_name?: string | null;
  third_party_contact_phone?: string | null;
  priority?: string;
  machine_model: string;
  task_description?: string;
  contact_person_name?: string | null;
  contact_designation?: string | null;
  contact_phone?: string | null;
  service_type?: string;
  service_charge?: number | null;
  payment_terms?: string | null;
  call_type?: string;
  creator_remarks?: string | null;
  task_allotted_to?: string | null;
  payment_status?: string | null;
  status?: string;
}
