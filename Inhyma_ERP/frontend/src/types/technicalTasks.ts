export interface TechnicalTask {
  id: string;
  company_name: string;
  task_type: string;
  city: string;
  third_party?: string | null;
  priority: string;
  machine_model: string;
  task_description: string;
  contact_person_name?: string | null;
  contact_designation?: string | null;
  contact_phone?: string | null;
  created_by_name: string;
  task_created_date: string;
  service_type: string;
  service_charge?: number | null;
  call_type: string;
  task_approved_by?: string | null;
  task_approved_date?: string | null;
  task_allotted_to?: string | null;
  payment_status?: string | null;
  status: string;
  completed_date?: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TechnicalTaskCounts {
  all: number;
  pending: number;
  approved: number;
  completed: number;
  cancel: number;
}

export interface TechnicalTaskCreatePayload {
  company_name: string;
  task_type?: string;
  city: string;
  third_party?: string | null;
  priority?: string;
  machine_model: string;
  task_description?: string;
  contact_person_name?: string | null;
  contact_designation?: string | null;
  contact_phone?: string | null;
  service_type?: string;
  service_charge?: number | null;
  call_type?: string;
  task_allotted_to?: string | null;
  payment_status?: string | null;
  status?: string;
}
