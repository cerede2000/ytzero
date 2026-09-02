import { useI18n } from "../i18n";
import { SelectMenu } from "./ui";

export type NotificationSourceMode = "default" | "on" | "off";

export default function NotificationSourceSelect({
  mode,
  defaultEnabled,
  label,
  disabled = false,
  onChange,
}: {
  mode: NotificationSourceMode;
  defaultEnabled: boolean;
  label: string;
  disabled?: boolean;
  onChange: (mode: NotificationSourceMode) => void;
}) {
  const { t } = useI18n();

  return <SelectMenu
    floating
    label={label}
    value={mode}
    disabled={disabled}
    options={[
      { value: "default" as const, label: t(defaultEnabled ? "notificationSourceDefaultOn" : "notificationSourceDefaultOff") },
      { value: "on" as const, label: t("notificationSourceAlwaysOn") },
      { value: "off" as const, label: t("notificationSourceAlwaysOff") },
    ]}
    onChange={onChange}
  />;
}
