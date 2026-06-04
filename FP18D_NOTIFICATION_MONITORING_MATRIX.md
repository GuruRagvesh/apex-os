# FP18D Notification Monitoring Matrix

| Domain | Event | Recipient | Trigger / Condition | Duplicate / Self-Prevention | Status |
|---|---|---|---|---|---|
| **Tickets** | Assignment | New Assignee | `assignedToId` changes upon creation or update. | Self-prevention: actor !== recipient. Duplicate: checked via existing assignee. | ✔️ Implemented |
| **Tickets** | Reassignment | Old Assignee | `assignedToId` changes from an existing value. | Self-prevention: actor !== recipient. | ✔️ Implemented |
| **Tickets** | Review Ready | Reviewer (TL/Manager) | Ticket transitions to `REVIEW`. | Self-prevention: actor !== recipient. | ✔️ Implemented |
| **Tickets** | Comment Added | Creator, Assignee | New comment on a ticket. | Self-prevention: actor !== recipient. | ✔️ Existing |
| **Tickets** | Approved/Done | Reporter/Assignee | Ticket marked `DONE`. | Self-prevention: actor !== recipient. | ✔️ Existing |
| **Tickets** | Blocked | Assignee, Reporter | Ticket marked `BLOCKED`. | Self-prevention: actor !== recipient. | ✔️ Existing |
| **Tickets** | Unblocked | Assignee | Ticket no longer `BLOCKED`. | Self-prevention: actor !== recipient. | ✔️ Existing |
| **Tickets** | SLA Overdue | TBD | Ticket SLA elapsed. | Defer to FP-18D.2 (No existing clean scheduler hook). | ⏳ Deferred |
| **Workday** | Auto-Close | User | Midnight boundary cron auto-closes active session. | Only sent upon state change (tracked by closure condition). | ✔️ Implemented |
| **Workday** | Resume | User | Start work picks up `AUTO_CLOSED` session. | Only sent if `session.autoClosed` was true. | ✔️ Implemented |
| **Hierarchy** | Request Created | Current Approver | New change request submitted. | Handled automatically. | ✔️ Existing |
| **Hierarchy** | Escalated | Next Approver | Approval escalates to next tier. | Handled automatically. | ✔️ Existing |
| **Hierarchy** | Approved / Rejected | Requester | Final decision reached. | Handled automatically. | ✔️ Existing |
