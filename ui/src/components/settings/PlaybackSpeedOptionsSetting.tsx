import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  DEFAULT_PLAYBACK_SPEEDS,
  MAX_CUSTOM_PLAYBACK_SPEEDS,
  MAX_PLAYBACK_SPEED,
  MIN_PLAYBACK_SPEED,
  normalizePlaybackSpeed,
} from "../../../../shared/playbackSpeeds";
import { useI18n } from "../../i18n";
import Tooltip from "../Tooltip";
import { Button, Field, IconButton, Input, InputGroup } from "../ui";
import "./PlaybackSpeedOptionsSetting.css";

export default function PlaybackSpeedOptionsSetting({ value, onChange }: {
  value: readonly string[];
  onChange: (next: string[]) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const normalized = normalizePlaybackSpeed(input);
  const alreadyAvailable = normalized != null && ([...DEFAULT_PLAYBACK_SPEEDS, ...value] as readonly string[]).includes(normalized);
  const invalid = input.trim() !== "" && normalized == null;
  const limitReached = value.length >= MAX_CUSTOM_PLAYBACK_SPEEDS;
  const errorText = saveError || (invalid ? t("customPlaybackSpeedRange") : alreadyAvailable ? t("customPlaybackSpeedDuplicate") : limitReached ? t("customPlaybackSpeedLimit", { count: MAX_CUSTOM_PLAYBACK_SPEEDS }) : "");

  const update = async (next: string[]): Promise<boolean> => {
    setSaving(true);
    setSaveError("");
    try {
      await onChange(next);
      return true;
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    if (!normalized || alreadyAvailable || limitReached || saving) return;
    if (await update([...value, normalized].sort((left, right) => Number(left) - Number(right)))) setInput("");
  };

  return <div className="playback-speed-options-setting">
    <Field className="playback-speed-options-setting__field">
      <div className="playback-speed-options-setting__entry">
        <Tooltip text={errorText} pos="left" portal open={Boolean(errorText)} className="playback-speed-options-setting__error-tooltip">
          <InputGroup>
            <Input
              type="number"
              inputMode="decimal"
              min={MIN_PLAYBACK_SPEED}
              max={MAX_PLAYBACK_SPEED}
              step="0.01"
              value={input}
              placeholder="2.3"
              aria-label={t("customPlaybackSpeedValue")}
              aria-invalid={Boolean(errorText)}
              disabled={saving || limitReached}
              onChange={(event) => { setInput(event.target.value); setSaveError(""); }}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void add(); } }}
            />
          </InputGroup>
        </Tooltip>
        <Button size="sm" leadingIcon={<Plus />} disabled={!normalized || alreadyAvailable || saving || limitReached} onClick={() => void add()}>
          {t("addPlaybackSpeed")}
        </Button>
      </div>
    </Field>
    {value.length > 0 && <div className="playback-speed-options-setting__values">
      {value.map((speed) => <span className="playback-speed-options-setting__value" key={speed}>
        {speed}×
        <IconButton
          size="sm"
          variant="ghost"
          label={t("removePlaybackSpeed", { speed })}
          disabled={saving}
          onClick={() => void update(value.filter((item) => item !== speed))}
        ><X /></IconButton>
      </span>)}
    </div>}
  </div>;
}
