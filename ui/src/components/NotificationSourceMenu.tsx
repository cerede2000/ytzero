import { useI18n } from "../i18n";
import { HeaderSettingsHeader, HeaderSettingsOption, HeaderSettingsSeparator } from "./HeaderSettingsMenu";
import type { NotificationSourceMode } from "./NotificationSourceSelect";

export default function NotificationSourceMenu({
  mode,
  defaultEnabled,
  title,
  disabled = false,
  onBack,
  onChange,
}: {
  mode: NotificationSourceMode;
  defaultEnabled: boolean;
  title: string;
  disabled?: boolean;
  onBack: () => void;
  onChange: (mode: NotificationSourceMode) => void;
}) {
  const { t } = useI18n();

  return <>
    <HeaderSettingsHeader onBack={onBack} backLabel={t("back")}>{title}</HeaderSettingsHeader>
    <HeaderSettingsOption selected={mode === "default"} disabled={disabled} onClick={() => onChange("default")}>
      {t(defaultEnabled ? "notificationSourceDefaultOn" : "notificationSourceDefaultOff")}
    </HeaderSettingsOption>
    <HeaderSettingsSeparator spacer />
    <HeaderSettingsOption selected={mode === "on"} disabled={disabled} onClick={() => onChange("on")}>
      {t("notificationSourceAlwaysOn")}
    </HeaderSettingsOption>
    <HeaderSettingsOption selected={mode === "off"} disabled={disabled} onClick={() => onChange("off")}>
      {t("notificationSourceAlwaysOff")}
    </HeaderSettingsOption>
  </>;
}
