import { useEffect, useState } from "react";
import { Copy, KeyRound, LoaderCircle, Trash2 } from "lucide-react";
import { api, type InvidiousTokenState } from "../api";
import { useI18n } from "../i18n";
import { frenchFor } from "../i18n/frenchOverlay";
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
  const { language } = useI18n();
  const tx = (en: string, pl: string, de: string, fr?: string) => language === "pl" ? pl : language === "de" ? de
    : language === "fr" ? fr ?? frenchFor(en) ?? en : en;
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
        <Alert variant="warning" title={tx("Not enabled", "Nieaktywne", "Nicht aktiviert", "Non activé")}>
          {tx(
            "Set YTZERO_INVIDIOUS_COMPAT=1 and restart for clients to reach this server.",
            "Ustaw YTZERO_INVIDIOUS_COMPAT=1 i uruchom ponownie, aby klienci mogli się połączyć.",
            "YTZERO_INVIDIOUS_COMPAT=1 setzen und neu starten, damit Clients diesen Server erreichen.",
            "Posez YTZERO_INVIDIOUS_COMPAT=1 et redémarrez pour que les applications puissent joindre ce serveur.",
          )}
        </Alert>
      )}

      <SettingRow
        label={tx("Client access token", "Token dostępu klienta", "Client-Zugriffstoken", "Jeton d'accès client")}
        description={state.configured
          ? tx(
            `Created ${when(state.created_at)} · last used ${when(state.last_used_at)}`,
            `Utworzono ${when(state.created_at)} · ostatnie użycie ${when(state.last_used_at)}`,
            `Erstellt ${when(state.created_at)} · zuletzt verwendet ${when(state.last_used_at)}`,
            `Créé le ${when(state.created_at)} · dernière utilisation ${when(state.last_used_at)}`,
          )
          : tx(
            "Sign in from an app with this profile's name and a token generated here. When the instance asks clients for credentials, that same pair goes in the app's HTTP Basic Auth fields.",
            "Zaloguj się w aplikacji nazwą tego profilu i wygenerowanym tu tokenem. Gdy instancja wymaga poświadczeń, ta sama para trafia w pola HTTP Basic Auth aplikacji.",
            "In einer App mit dem Namen dieses Profils und einem hier erzeugten Token anmelden. Verlangt die Instanz Zugangsdaten, gehört dasselbe Paar in die HTTP-Basic-Auth-Felder der App.",
            "Connectez-vous depuis une application avec le nom de ce profil et un jeton généré ici. Si l'instance demande des identifiants, c'est la même paire qui va dans les champs HTTP Basic Auth de l'application.",
          )}
      >
        <Inline>
          <Button onClick={() => void mint()} disabled={busy}>
            {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
            {state.configured
              ? tx("Regenerate", "Wygeneruj ponownie", "Neu erzeugen", "Régénérer")
              : tx("Generate", "Wygeneruj", "Erzeugen", "Générer")}
          </Button>
          {state.configured && (
            <Button variant="danger" onClick={() => void revoke()} disabled={busy}>
              <Trash2 aria-hidden="true" />
              {tx("Revoke", "Unieważnij", "Widerrufen", "Révoquer")}
            </Button>
          )}
        </Inline>
      </SettingRow>

      {minted && (
        <Alert variant="info" title={tx("Copy it now", "Skopiuj teraz", "Jetzt kopieren", "Copiez-le maintenant")}>
          <Text>{tx(
            "This is the only time it is shown. Regenerating replaces it and signs out every device using it.",
            "To jedyny raz, gdy jest widoczny. Ponowne wygenerowanie zastępuje go i wylogowuje wszystkie urządzenia.",
            "Es wird nur dieses eine Mal angezeigt. Neu erzeugen ersetzt es und meldet alle Geräte ab.",
            "C'est la seule fois où il est affiché. Le régénérer le remplace et déconnecte tous les appareils qui l'utilisent.",
          )}</Text>
          <Inline>
            <code className="invidious-token">{minted}</code>
            <Button onClick={() => {
              void navigator.clipboard.writeText(minted);
              showToast(tx("Copied", "Skopiowano", "Kopiert", "Copié"));
            }}>
              <Copy aria-hidden="true" />
              {tx("Copy", "Kopiuj", "Kopieren", "Copier")}
            </Button>
          </Inline>
        </Alert>
      )}
    </>
  );
}
