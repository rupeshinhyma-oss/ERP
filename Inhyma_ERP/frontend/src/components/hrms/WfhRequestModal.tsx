/**
 * WfhRequestModal Component
 *
 * Employee Work-From-Home (WFH) Request Flow:
 * Powered by the reusable AddressMapConfirmModal:
 * - Enter Date, Reason, and Work Address
 * - Resolve address to interactive map with draggable pin
 * - Confirm pin position and radius preview
 * - Submit request to manager approval queue
 */

import { AddressMapConfirmModal, type AddressMapConfirmData } from "./AddressMapConfirmModal";
import { apiPost } from "@/lib/api";

export interface WfhRequestModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function WfhRequestModal({ open, onClose, onSuccess }: WfhRequestModalProps) {
  const handleConfirm = async (data: AddressMapConfirmData) => {
    await apiPost("/api/v1/hrms/wfh-requests", {
      wfh_date: data.wfh_date,
      reason: data.reason,
      address: data.address,
      latitude: data.latitude,
      longitude: data.longitude,
      radius_meters: data.radius_meters || 150,
      place_id: data.place_id,
    });
    onSuccess?.();
  };

  return (
    <AddressMapConfirmModal
      open={open}
      onClose={onClose}
      mode="wfh"
      title="Request Work-From-Home (WFH)"
      onConfirm={handleConfirm}
    />
  );
}
