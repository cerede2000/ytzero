import type { ReactNode } from "react";
import { SelectMenu } from "./Selection";
import { cx } from "./utils";
import "./PermissionMatrix.css";

export type PermissionMatrixValue = "inherit" | "allow" | "deny";

export function PermissionMatrix<Row extends { id: number | string }>({ rows, columns, valueFor, onChange, renderRow, disabled, rowHeader = "Profile", stateLabels = { inherit: "Inherited", allow: "Allowed", deny: "Denied" } }: {
  rows: readonly Row[];
  columns: readonly { id: string; label: ReactNode }[];
  valueFor: (row: Row, columnId: string) => PermissionMatrixValue;
  onChange: (row: Row, columnId: string, value: PermissionMatrixValue) => void;
  renderRow: (row: Row) => ReactNode;
  disabled?: (row: Row) => boolean;
  rowHeader?: ReactNode;
  stateLabels?: Record<PermissionMatrixValue, string>;
}) {
  const options: { value: PermissionMatrixValue; label: string }[] = [
    { value: "inherit", label: stateLabels.inherit }, { value: "allow", label: stateLabels.allow }, { value: "deny", label: stateLabels.deny },
  ];
  return <div className="ui-permission-matrix-wrap"><table className="ui-permission-matrix">
    <thead><tr><th scope="col">{rowHeader}</th>{columns.map((column) => <th key={column.id} scope="col">{column.label}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id} className={cx(disabled?.(row) && "ui-permission-matrix__row--disabled")}>
      <th scope="row">{renderRow(row)}</th>
      {columns.map((column) => <td key={column.id}><SelectMenu
        value={valueFor(row, column.id)} options={options}
        label={typeof column.label === "string" ? column.label : String(column.id)} size="sm"
        disabled={disabled?.(row)} onChange={(value) => onChange(row, column.id, value)}
      /></td>)}
    </tr>)}</tbody>
  </table></div>;
}
