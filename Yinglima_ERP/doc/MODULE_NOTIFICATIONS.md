# Module Guide: Notification & Automation System (`notifications`)

**System:** Yinglima_ERP  
**Module:** Enterprise Notification Rules & Real-time Inbox (`/notifications`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-19  

---

## 1. Overview & Purpose

The **Notification & Automation System** delivers real-time operational alerts across Yinglima_ERP. It enables administrators and logistics managers to configure granular event-driven notification rules based on business triggers in **Shipment Planning**, **Sales Process**, **Local Purchase**, and **Inquiries**.

Alerts are delivered in real-time to the application topbar (`NotificationBell`), supporting instant unread count badge updates, direct navigation to the triggering entity, and mark-as-read status management.

---

## 2. Key Architecture & File Map

### Frontend:
* **Topbar Notification Bell & Dropdown:** [`NotificationBell.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/NotificationBell.tsx) (integrated in [`AppShell.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/AppShell.tsx))
* **Notification Rules & Configuration Modal:** [`NotificationSettings.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/NotificationSettings.tsx) (Route: `/settings/notifications`)
* **TypeScript Types & Enums:** [`notifications.ts`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/types/notifications.ts)

### Backend:
* **Routes & Endpoints:** [`app/notifications/routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/notifications/routes.py)
* **Service & Dispatcher Engine:** [`app/notifications/service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/notifications/service.py)
* **Data Models:** [`app/notifications/models.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/notifications/models.py) (`notification_rules`, `notifications_inbox`, `notification_user_settings`)
* **Pydantic Schemas:** [`app/notifications/schemas.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/notifications/schemas.py)
* **Database Migration:** [`a2b3c4d5e6f7_create_notification_rules_and_system.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/a2b3c4d5e6f7_create_notification_rules_and_system.py)

---

## 3. Supported Event Triggers

The system automatically listens for and dispatches notifications on the following system events:

| Event Identifier | Source Module | Triggering Action | Default Alert Template |
| :--- | :--- | :--- | :--- |
| `shipment_requirement_raised` | Shipment Planning | When a shipment line requires urgent planning / procurement | *"New shipment requirement raised for {item_name} ({qty} units)"* |
| `shipment_status_ordered` | Shipment Planning | When container / shipment is ordered or scheduled | *"Shipment order confirmed for {shipment_name}"* |
| `sale_process_created` | Sales Process | When a new client sales order / process is initiated | *"New sale process {order_number} created for {buyer_name}"* |
| `local_purchase_created` | Local Purchase | When a domestic purchase order is submitted | *"New local purchase PO #{po_number} created"* |
| `inquiry_created` | Inquiries & RFQs | When a customer inquiry is logged or received | *"New inquiry #{inquiry_code} created from {buyer_name}"* |

---

## 4. Rule Configuration & Recipient Target Resolution

Each Notification Rule allows granular control over:
1. **Rule Status:** `is_active` toggle to enable/disable automated dispatch without deleting rule configuration.
2. **Delivery Channels:** Multi-select supporting `in_app` (live topbar inbox), `email` (SMTP outbound), and `push` (browser web push).
3. **Role-Based Recipients:** Configurable recipient roles (e.g., `admin`, `logistics_manager`, `procurement_manager`). Any user possessing that role receives the alert.
4. **Specific User Recipients:** Direct assignment of individual users (`user_ids`). Users can be searched and selected dynamically in the modal via typeahead.
5. **Deduplication:** When a user qualifies through both a role and direct assignment, the dispatcher deduplicates to guarantee only one inbox notification is generated per user.

---

## 5. Topbar Notification Bell & Polling Behavior

1. **Unread Count Badge:**
   - Appears as a bright amber/red pill badge when unread notifications $> 0$.
   - Automatically collapses when count $= 0$.
2. **Polling Frequency:**
   - Background interval polls `GET /api/v1/notifications/unread-count` every 30 seconds.
   - Instant refresh triggers on user opening the notification dropdown or clicking "Mark all as read".
3. **Interactive Actions:**
   - **Click on Notification Item:** Marks the single notification as read (`PATCH /notifications/{id}/read`) and navigates directly to the associated module/entity via `link_url`.
   - **Mark All as Read:** Immediately clears the unread badge and updates all items to read (`POST /notifications/mark-all-read`).
   - **Configure Rules Button:** Direct link opening `NotificationSettings.tsx` for authorized administrators.

---

## 6. What Needs to Be Verified (Testing Checklist)

- [ ] **Event Triggering Verification:**
  - Create a new Sale Process. Verify a notification is delivered to configured users.
  - Create a Local Purchase. Verify a notification is delivered.
  - Create a customer Inquiry. Verify a notification is delivered.
- [ ] **Rule Configuration & Search:**
  - Open Notification Settings.
  - Click **Edit** on a rule.
  - Type in the user search bar (e.g. `user b` or user name).
  - Verify matching users appear in the list and can be toggled on/off.
- [ ] **Mark as Read & Badge Sync:**
  - Click an unread notification item.
  - Verify unread counter decrements by 1 and user is routed to the target document.
  - Click **Mark all as read**. Verify counter badge disappears.
- [ ] **Permission Isolation:**
  - Only users with `settings.manage` or `admin` permissions can edit notification rules.
  - Users can only read notifications directed to their own user ID.

---

## 7. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict rules to observe when modifying the Notification System:**

1. **Async Non-Blocking Dispatch:**
   - Always dispatch notifications in background tasks or non-blocking async calls so transactional database commits (such as saving a PO or creating an Inquiry) never hang or fail due to email or websocket delivery delays.
2. **Safe Fallback for Missing Users/Roles:**
   - If a rule specifies a user or role that has been deleted or deactivated, the dispatcher must skip that recipient gracefully without aborting notification delivery to remaining valid recipients.
3. **Envelope Compatibility in API Responses:**
   - Keep user search parsing in [`NotificationSettings.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/NotificationSettings.tsx) compatible with paginated `{ items: [...] }` envelopes as well as raw lists.
