// The data sheet: every form field and value that will be sent to the company.
// On Review it shows the sheet being approved. On Open application it shows the frozen sheet the
// person approved, with a copy button on every value to paste into the company's form.
// Spec: PRD A3 and U1, ARCHITECTURE.md section 5.7 (DataSheet).
import type { DataSheet } from "@jobgoblin/schemas";
import { useTranslation } from "react-i18next";
import { CopyButton } from "./CopyButton";
import { Badge } from "./ui/Badge";

type DataSheetTableProps = {
  dataSheet: DataSheet;
  showCopyButtons: boolean;
};

export function DataSheetTable({ dataSheet, showCopyButtons }: DataSheetTableProps) {
  const { t } = useTranslation();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t("common:dataSheet.caption")}</caption>
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th scope="col" className="py-2 pr-4 font-medium">
              {t("common:dataSheet.field")}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {t("common:dataSheet.value")}
            </th>
            {showCopyButtons && (
              <th scope="col" className="py-2 font-medium">
                <span className="sr-only">{t("common:copy.copy")}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {dataSheet.fields.map((field) => (
            <tr key={field.key} className="border-b border-line last:border-b-0">
              <th scope="row" className="py-2 pr-4 align-top font-normal text-muted">
                {field.label}
              </th>
              <td className="py-2 pr-4 align-top break-words">
                {field.missing ? <Badge tone="amber">{t("common:dataSheet.missing")}</Badge> : field.value}
              </td>
              {showCopyButtons && (
                <td className="py-1 align-top whitespace-nowrap">
                  {!field.missing && <CopyButton text={field.value} label={field.label} />}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
