import type { ReactNode } from 'react';
import { Breadcrumb, type BreadcrumbItem } from './breadcrumb';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumb?: BreadcrumbItem[];
  /** Page actions, shown on the right. Put the one primary button last. */
  actions?: ReactNode;
}

// The one page header from DESIGN.md → Layout: breadcrumb, title (normal case),
// optional one-line description, and actions on the right.
export function PageHeader({ title, description, breadcrumb, actions }: PageHeaderProps) {
  return (
    <header className="apex-page-header">
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
        <h1 className="apex-page-title">{title}</h1>
        {description && <p className="apex-page-description">{description}</p>}
      </div>
      {actions && <div className="apex-page-header-actions">{actions}</div>}
    </header>
  );
}
