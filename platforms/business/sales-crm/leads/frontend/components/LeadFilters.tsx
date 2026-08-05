import { Role } from "@/lib/sales-crm/types";
import { MOCK_USERS } from "@/lib/sales-crm/constants";
import { LeadFilterState, LeadSortState } from "../api/lead-calculations";
import styles from "@/styles/sales-crm/leads.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

interface LeadFiltersProps {
  filters: LeadFilterState;
  setFilters: (filters: LeadFilterState) => void;
  sortState: LeadSortState;
  setSortState: (sort: LeadSortState) => void;
  onClear: () => void;
  assignableUsers?: { id: string; name: string; role: Role }[];
}

export default function LeadFilters({ filters, setFilters, sortState, setSortState, onClear, assignableUsers }: LeadFiltersProps) {
  const hasActiveFilters = filters.owner || filters.stage || filters.source || filters.alert || filters.dateFrom;
  const ownerOptions = assignableUsers ?? MOCK_USERS;

  return (
    <div className={styles["lead-filters-card"]}>
      <select
        className={ui["ui-select"]}
        value={filters.owner}
        onChange={(e) => setFilters({ ...filters, owner: e.target.value })}
      >
        <option value="">All Owners</option>
        {ownerOptions.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>

      <select
        className={ui["ui-select"]}
        value={filters.stage}
        onChange={(e) => setFilters({ ...filters, stage: e.target.value })}
      >
        <option value="">All Stages</option>
        <option value="Created">Created</option>
        <option value="Cold">Cold</option>
        <option value="Level 0">Level 0</option>
        <option value="Level 1">Level 1</option>
        <option value="Level 2">Level 2</option>
        <option value="Level 3">Level 3</option>
        <option value="Level 4">Level 4</option>
        <option value="Level 5">Level 5</option>
        <option value="Level 6">Level 6</option>
        <option value="Closed">Closed</option>
      </select>

      <select
        className={ui["ui-select"]}
        value={filters.source}
        onChange={(e) => setFilters({ ...filters, source: e.target.value })}
      >
        <option value="">All Sources</option>
        <option value="LinkedIn">LinkedIn</option>
        <option value="Referral">Referral</option>
        <option value="Website">Website</option>
        <option value="Conference">Conference</option>
        <option value="Email Campaign">Email Campaign</option>
        <option value="Direct">Direct</option>
        <option value="Organic Search">Organic Search</option>
        <option value="Trade Show">Trade Show</option>
      </select>

      <input
        type="date"
        className={ui["ui-input"]}
        aria-label="Created date"
        value={filters.dateFrom || ""}
        onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
      />

      <select
        className={ui["ui-select"]}
        value={sortState.field}
        onChange={(e) => setSortState({ ...sortState, field: e.target.value as LeadSortState['field'] })}
      >
        <option value="createdDate">Sort: Created Date</option>
        <option value="lastActivityDate">Sort: Last Activity</option>
        <option value="leadScore">Sort: Lead Score</option>
      </select>

      <select
        className={ui["ui-select"]}
        value={sortState.direction}
        onChange={(e) => setSortState({ ...sortState, direction: e.target.value as LeadSortState['direction'] })}
      >
        <option value="desc">Descending</option>
        <option value="asc">Ascending</option>
      </select>

      {hasActiveFilters && (
        <button
          className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`}
          onClick={onClear}
        >
          Clear Filters
        </button>
      )}
    </div>
  );
}
