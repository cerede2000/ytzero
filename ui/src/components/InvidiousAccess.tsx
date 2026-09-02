import { useEffect, useState } from "react";
import { Copy, KeyRound, LoaderCircle, Trash2 } from "lucide-react";
import { api, type InvidiousTokenState } from "../api";
import { useI18n } from "../i18n";
import { Alert, Button, Inline, SettingRow, Text } from "./ui";
import "./DatabaseSettings.css";

/**
 * Where a profile hands its phone a way in.
 *
 * The token is shown once, at the moment it is minted: what the server keeps
 * is a keyed hash of it, so this screen cannot show it again — and saying so
 * plainly is the difference between somebody copying it now and somebody
 * coming back for it later.
 */
export default function InvidiousAccess({ showToast }: { showToast: (message: string) => void }) {
  const { language, t } = useI18n();
  const [state, setState] = useState<InvidiousTokenState | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.invidiousToken().then(setState).catch((error) => showToast(error.message));
  useEffect(() => { void load(); }, []);

  const mint = async () => {
    setBusy(true);
    try {
      const { token } = await api.mintInvidiousToken();
      setMinted(token);
      await load();
    } catch (error: any) {
      showToast(error?.message ?? String(error));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await api.revokeInvidiousToken();
      setMinted(null);
      await load();
    } catch (error: any) {
      showToast(error?.message ?? String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;

  const when = (value: string | null) => value ? new Date(value.replace(" ", "T") + "Z").toLocaleString() : "—";

  return (
    <>
      {!state.enabled && (
        <Alert variant="warning" title={t("clientAccessNotEnabled")}>
          {t("clientAccessNotEnabledHint")}
        </Alert>
      )}

      <SettingRow
        label={t("clientAccessToken")}
        description={state.configured
          ? t("clientAccessTokenUsage", { created: when(state.created_at), used: when(state.last_used_at) })
          : t("clientAccessTokenHint")}
      >
        <Inline>
          <Button onClick={() => void mint()} disabled={busy}>
            {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
            {state.configured
              ? t("clientAccessRegenerate")
              : t("clientAccessGenerate")}
          </Button>
          {state.configured && (
            <Button variant="danger" onClick={() => void revoke()} disabled={busy}>
              <Trash2 aria-hidden="true" />
              {t("clientAccessRevoke")}
            </Button>
          )}
        </Inline>
      </SettingRow>

      {minted && (
        <Alert variant="info" title={t("clientAccessCopyNow")}>
          <Text>{t("clientAccessCopyNowHint")}</Text>
          <Inline>
            <code className="invidious-token">{minted}</code>
            <Button onClick={() => {
              void navigator.clipboard.writeText(minted);
              showToast(t("clientAccessCopied"));
            }}>
              <Copy aria-hidden="true" />
              {t("clientAccessCopy")}
            </Button>
          </Inline>
        </Alert>
      )}
    </>
  );
}
