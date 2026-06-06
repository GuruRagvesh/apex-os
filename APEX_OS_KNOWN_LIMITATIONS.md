# APEX OS KNOWN LIMITATIONS

While the FP-19 stabilization release has successfully fortified the core application workflow, several honest limitations remain present in the system environment and codebase. These limitations do not block daily operational delivery, but they represent known gaps that all administrators and stakeholders should be aware of.

## 1. Automated vs. Manual Testing Scope
The recent smoke test was heavily reliant on automated, build-level validations and headless server unit tests. While they provide excellent mathematical and logical assurance of the backend rules, a **manual live acceptance test** has not yet been thoroughly executed on the production UI.

## 2. Historical Workday Records
The runtime application is now guarded against massive workday duration overflows and impossible log entries. However, **legacy historical records** generated prior to this fix may still reflect corrupted or mathematically impossible durations (e.g., sessions longer than 24 hours). These records still require manual review and the execution of the dedicated FP-19B repair scripts.

## 3. Advanced Notification Capabilities
The notification engine successfully routes standard workflow events. However, **advanced SLA breach notifications** and custom warning thresholds (e.g., "Warning: Ticket SLA breaches in 30 minutes") are currently deferred.

## 4. UI Polish and Action Center
The Dashboard's Action Center functionality remains structurally sound but visually unpolished. Some lists may lack pagination or deep-sort features. A comprehensive UI cleanup pass is pending.

## 5. Module Expansions (CRM, HRMS, AI)
This stabilization release strictly focused on core Apex OS features (Workday and Tickets). A full CRM integration, extended HRMS functionality (beyond leave), and all generative AI features were explicitly kept outside the scope of this delivery release.

## 6. Administrative Tooling
Currently, there is no built-in graphical user interface (Admin Correction Screen) for administrators to manually edit, split, or correct errant workday logs directly from the frontend dashboard. 

## 7. Repository Hygiene Recommendation
The workspace currently contains a vast amount of legacy audit, plan, and issue registry markdown files in its root directory. This creates significant clutter. 
**Recommendation**: In a future repository cleanup phase, all old FP reports should be moved to a structured `docs/archive/` folder, relevant `.gitignore` rules should be updated, and only the current release documents should remain in the root folder.
