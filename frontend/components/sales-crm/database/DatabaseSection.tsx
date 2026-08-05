"use client";

import { useState, useMemo } from "react";
import { CollectionType, DatabaseRecord } from "@/lib/sales-crm/database-schema";
import { computeLinkedData } from "@/lib/sales-crm/database-utils";
import { UserCog, Archive } from "lucide-react";
import styles from "@/styles/sales-crm/database.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

interface DatabaseSectionProps {
  title: CollectionType;
  records: DatabaseRecord[];
  canAdd: boolean;
  canEditRecord: (record: DatabaseRecord) => boolean;
  canArchive: boolean;
  onAdd: (collection: CollectionType) => void;
  onUpdate: (collection: CollectionType, record: DatabaseRecord) => void;
  onArchive: (collection: CollectionType, recordId: string) => void;
}

export default function DatabaseSection({
  title,
  records,
  canAdd,
  canEditRecord,
  canArchive,
  onAdd,
  onUpdate,
  onArchive,
}: DatabaseSectionProps) {
  const [search, setSearch] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<{ collection: CollectionType; recordId: string } | null>(null);

  const activeRecords = useMemo(() => {
    return records.filter((r) => r.archived !== "Yes");
  }, [records]);

  const filteredRecords = useMemo(() => {
    if (!search.trim()) return activeRecords;

    const lowerSearch = search.toLowerCase();
    return activeRecords.filter((r) => {
      return Object.values(r).some((val) => String(val).toLowerCase().includes(lowerSearch));
    });
  }, [activeRecords, search]);

  const displayedRecords = isExpanded ? filteredRecords : filteredRecords.slice(0, 3);

  let addText = "";
  let showAdd = canAdd;

  switch (title) {
    case "Clients":
      addText = "Add Client";
      break;
    case "Vendors":
      addText = "Add Vendor";
      break;
    case "Trainers":
      addText = "Add Trainer";
      break;
    case "Service Database":
      addText = "Add Service Line";
      break;
    case "Leads Master":
      showAdd = false;
      break;
    default:
      addText = `Add ${title}`;
  }

  const renderColGroup = () => {
    switch (title) {
      case "Clients":
        return (
          <colgroup>
            <col className={styles["db-col-clients-company"]} />
            <col className={styles["db-col-clients-industry"]} />
            <col className={styles["db-col-clients-city"]} />
            <col className={styles["db-col-clients-country"]} />
            <col className={styles["db-col-clients-linked"]} />
            <col className={styles["db-col-actions"]} />
          </colgroup>
        );
      case "Leads Master":
        return (
          <colgroup>
            <col className={styles["db-col-leads-company"]} />
            <col className={styles["db-col-leads-service"]} />
            <col className={styles["db-col-leads-stage"]} />
            <col className={styles["db-col-leads-owner"]} />
            <col className={styles["db-col-leads-req"]} />
            <col className={styles["db-col-leads-status"]} />
            <col className={styles["db-col-actions"]} />
          </colgroup>
        );
      case "Trainers":
        return (
          <colgroup>
            <col className={styles["db-col-trainers-first"]} />
            <col className={styles["db-col-trainers-last"]} />
            <col className={styles["db-col-trainers-skills"]} />
            <col className={styles["db-col-trainers-rate"]} />
            <col className={styles["db-col-trainers-phone"]} />
            <col className={styles["db-col-trainers-email"]} />
            <col className={styles["db-col-trainers-status"]} />
            <col className={styles["db-col-trainers-linked"]} />
            <col className={styles["db-col-actions"]} />
          </colgroup>
        );
      case "Vendors":
        return (
          <colgroup>
            <col className={styles["db-col-vendors-company"]} />
            <col className={styles["db-col-vendors-contact"]} />
            <col className={styles["db-col-vendors-service"]} />
            <col className={styles["db-col-vendors-phone"]} />
            <col className={styles["db-col-vendors-email"]} />
            <col className={styles["db-col-vendors-linked"]} />
            <col className={styles["db-col-actions"]} />
          </colgroup>
        );
      case "Service Database":
        return (
          <colgroup>
            <col className={styles["db-col-services-name"]} />
            <col className={styles["db-col-services-category"]} />
            <col className={styles["db-col-services-type"]} />
            <col className={styles["db-col-services-status"]} />
            <col className={styles["db-col-actions"]} />
          </colgroup>
        );
      default:
        return null;
    }
  };

  const renderTableHead = () => {
    switch (title) {
      case "Clients":
        return (
          <tr>
            <th>Company Name</th>
            <th>Industry</th>
            <th>City</th>
            <th>Country</th>
            <th>Linked Data</th>
            <th className={styles["db-actions-cell"]}>Actions</th>
          </tr>
        );
      case "Leads Master":
        return (
          <tr>
            <th>Company Name</th>
            <th>Service Interest</th>
            <th>Pipeline Stage</th>
            <th>Owner ID</th>
            <th>Converted Requirement ID</th>
            <th>Status</th>
            <th className={styles["db-actions-cell"]}>Actions</th>
          </tr>
        );
      case "Trainers":
        return (
          <tr>
            <th>First Name</th>
            <th>Last Name</th>
            <th>Skills</th>
            <th>Commercial Rate</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Vendor Status</th>
            <th>Linked Data</th>
            <th className={styles["db-actions-cell"]}>Actions</th>
          </tr>
        );
      case "Vendors":
        return (
          <tr>
            <th>Company Name</th>
            <th>Vendor Contact</th>
            <th>Service Area</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Linked Data</th>
            <th className={styles["db-actions-cell"]}>Actions</th>
          </tr>
        );
      case "Service Database":
        return (
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Service Type</th>
            <th>Status</th>
            <th className={styles["db-actions-cell"]}>Actions</th>
          </tr>
        );
      default:
        return null;
    }
  };

  const renderTableRow = (record: DatabaseRecord) => {
    switch (title) {
      case "Clients":
        return (
          <tr key={record.id}>
            <td className={styles["db-table-cell-wrap"]}>
              <strong>{String(record.company_name || "")}</strong>
            </td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.industry || "")}>
              {String(record.industry || "")}
            </td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.city || "")}>
              {String(record.city || "")}
            </td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.country || "")}>
              {String(record.country || "")}
            </td>
            <td className={styles["db-table-cell-wrap"]}>{computeLinkedData("Clients")}</td>
            {renderActions(record)}
          </tr>
        );
      case "Leads Master":
        return (
          <tr key={record.id}>
            <td className={styles["db-table-cell-wrap"]}>
              <strong>{String(record.company_name || "")}</strong>
            </td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.service_interest || "")}>
              {String(record.service_interest || "")}
            </td>
            <td>
              <span className={`${ui["ui-badge"]} ui-badge-outline`}>{String(record.pipeline_stage || "")}</span>
            </td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.owner_id || "")}>
              {String(record.owner_id || "")}
            </td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.converted_requirement_id || "")}>
              {String(record.converted_requirement_id || "")}
            </td>
            <td>
              <span className={record.status === "Archived" ? "db-status-dot db-status-dot-archived" : "db-status-dot db-status-dot-active"}></span>
              {String(record.status || "")}
            </td>
            {renderActions(record)}
          </tr>
        );
      case "Trainers":
        return (
          <tr key={record.id}>
            <td className={styles["db-table-cell-truncate"]} title={String(record.first_name || "")}>
              {String(record.first_name || "")}
            </td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.last_name || "")}>
              {String(record.last_name || "")}
            </td>
            <td className={styles["db-table-cell-wrap"]}>{String(record.skills || "")}</td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.commercial_rate || "")}>
              {String(record.commercial_rate || "")}
            </td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.phone || "")}>
              {String(record.phone || "")}
            </td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.email || "")}>
              {String(record.email || "")}
            </td>
            <td>
              <span className={`${ui["ui-badge"]} ui-badge-outline`}>{String(record.vendor_status || "")}</span>
            </td>
            <td className={styles["db-table-cell-wrap"]}>{computeLinkedData("Trainers")}</td>
            {renderActions(record)}
          </tr>
        );
      case "Vendors":
        return (
          <tr key={record.id}>
            <td className={styles["db-table-cell-wrap"]}>
              <strong>{String(record.company_name || "")}</strong>
            </td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.vendor_contact || "")}>
              {String(record.vendor_contact || "")}
            </td>
            <td className={styles["db-table-cell-wrap"]}>{String(record.service_area || "")}</td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.phone || "")}>
              {String(record.phone || "")}
            </td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.email || "")}>
              {String(record.email || "")}
            </td>
            <td className={styles["db-table-cell-wrap"]}>{computeLinkedData("Vendors")}</td>
            {renderActions(record)}
          </tr>
        );
      case "Service Database":
        return (
          <tr key={record.id}>
            <td className={styles["db-table-cell-wrap"]}>
              <strong>{String(record.name || "")}</strong>
            </td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.category || "")}>
              {String(record.category || "")}
            </td>
            <td className={styles["db-table-cell-truncate"]} title={String(record.service_type || "")}>
              {String(record.service_type || "")}
            </td>
            <td>
              <span className={`${ui["ui-badge"]} ui-badge-outline`}>{String(record.status || "")}</span>
            </td>
            {renderActions(record)}
          </tr>
        );
      default:
        return null;
    }
  };

  const renderActions = (record: DatabaseRecord) => (
    <td className={styles["db-actions-cell"]}>
      <div className={styles["db-table-more-actions"]}>
        {canEditRecord(record) && (
          <button
            className={`${ui["ui-btn"]} ui-btn-outline ${ui["ui-btn-sm"]} ${styles["db-icon-button"]} ${styles["db-icon-button-update"]}`}
            title="Update Profile"
            aria-label="Update Profile"
            onClick={() => onUpdate(title, record)}
          >
            <UserCog size={16} />
          </button>
        )}
        {canArchive && (
          <button
            className={`${ui["ui-btn"]} ui-btn-outline ${ui["ui-btn-sm"]} ${styles["db-icon-button"]} ${styles["db-icon-button-archive"]}`}
            title="Archive"
            aria-label="Archive"
            onClick={() => {
              if (record.id) {
                setArchiveConfirm({ collection: title, recordId: record.id });
              }
            }}
          >
            <Archive size={16} />
          </button>
        )}
      </div>
    </td>
  );

  let accentClass = "";
  if (title === "Clients") accentClass = styles["db-accent-clients"];
  if (title === "Leads Master") accentClass = styles["db-accent-leads"];
  if (title === "Vendors") accentClass = styles["db-accent-vendors"];
  if (title === "Trainers") accentClass = styles["db-accent-trainers"];
  if (title === "Service Database") accentClass = styles["db-accent-services"];

  return (
    <div className={`${ui["ui-card"]} ${styles["db-section"]} ${accentClass}`}>
      <div className={ui["ui-card-body"]}>
        <div className={styles["db-section-header"]}>
          <div className={styles["db-section-title-row"]}>
            <h2 className={styles["db-section-title"]}>
              {title} <span className={ui["ui-badge"]}>{filteredRecords.length}</span>
            </h2>
          </div>
          <div className={styles["db-section-toolbar"]}>
            <input
              type="text"
              placeholder={`Search ${title.toLowerCase()}...`}
              className={`${ui["ui-input"]} ${styles["db-search-input"]}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {canAdd && showAdd && (
              <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={() => onAdd(title)}>
                + {addText}
              </button>
            )}
          </div>
        </div>

        <div className={`${styles["db-table-container"]} ${isExpanded ? styles["db-table-scroll-expanded"] : ""}`}>
          <table className={styles["db-table"]}>
            {renderColGroup()}
            <thead>{renderTableHead()}</thead>
            <tbody>
              {displayedRecords.length > 0 ? (
                displayedRecords.map(renderTableRow)
              ) : (
                <tr>
                  <td colSpan={10} className={styles["db-table-empty"]}>
                    No records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filteredRecords.length > 3 && (
          <div className={styles["db-action-row"]}>
            <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={() => setIsExpanded(!isExpanded)}>
              {isExpanded ? "Show Less" : "Show More"}
            </button>
          </div>
        )}
      </div>

      {archiveConfirm && (
        <div className={ui["ui-modal-overlay"]}>
          <div className={`${ui["ui-modal"]} ${styles["db-modal-sm"]} ${styles["db-modal-center"]}`}>
            <h3 className={ui["ui-modal-header"]}>Confirm Archive</h3>
            <div className={ui["ui-modal-body"]}>
              <p>Are you sure you want to archive this record?</p>
            </div>
            <div className={`${ui["ui-modal-footer"]} ${styles["db-action-row"]}`}>
              <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={() => setArchiveConfirm(null)}>
                Cancel
              </button>
              <button
                className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]} ${styles["db-danger-button"]}`}
                onClick={() => {
                  onArchive(archiveConfirm.collection, archiveConfirm.recordId);
                  setArchiveConfirm(null);
                }}
              >
                Archive
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
