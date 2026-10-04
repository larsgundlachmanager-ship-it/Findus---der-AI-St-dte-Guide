from pathlib import Path

p = Path(r"C:\Users\larsf\Findus 2.0\src\onboarding\AuthGateStep.tsx")
t = p.read_text(encoding="utf-8")

old = """  const sendLink = async () => {
    const trimmed = email.trim();
    if (!/@/.test(trimmed) || busy) return;
    await onMagicLink(trimmed, 'register');
  };"""

new = """  const sendLink = async (): Promise<boolean> => {
    const trimmed = email.trim();
    if (!/@/.test(trimmed) || busy) return false;
    const r = await onMagicLink(trimmed, 'register');
    return !!r?.ok;
  };"""

if old not in t:
    raise SystemExit("sendLink block not found")
t = t.replace(old, new)

old_btn = """                  onPress={() => {
                    void (async () => {
                      await sendLink();
                      setLinkSent(true);
                      Alert.alert(
                        'Magic Link gesendet',
                        `Wir haben dir eine E-Mail${email.trim() ? ` an ${email.trim()}` : ''} geschickt. Tippe den Link darin — Yorro öffnet sich und bestätigt dein Konto.`,
                        [{ text: 'OK' }],
                      );
                    })();
                  }}"""

new_btn = """                  onPress={() => {
                    void (async () => {
                      const ok = await sendLink();
                      if (!ok) return;
                      setLinkSent(true);
                      Alert.alert(
                        'Magic Link gesendet',
                        `Wir haben dir eine E-Mail${email.trim() ? ` an ${email.trim()}` : ''} geschickt. Tippe den Link darin — Yorro öffnet sich und bestätigt dein Konto.`,
                        [{ text: 'OK' }],
                      );
                    })();
                  }}"""

if old_btn not in t:
    raise SystemExit("button handler not found")
t = t.replace(old_btn, new_btn)
p.write_text(t, encoding="utf-8")
print("OK AuthGateStep")
