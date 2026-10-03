/** Boot screen, sign-in (with second factor) and first-run onboarding. */
import { useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, LogIn, Sparkles, UserPlus, ArrowRight, ArrowLeft, ShieldCheck, Check } from 'lucide-react';
import { useT } from '@/hooks/useT';
import { useUI } from '@/state/ui';
import { useSession } from '@/state/session';
import { useLive } from '@/hooks/data';
import { db } from '@/core/db/db';
import { Crest, RuneSigil } from '@/ui/heraldry';
import { Alert, Avatar, Button, Field, Input, Select, Badge } from '@/ui/primitives';
import { ErrorPanel } from '@/ui/ErrorPanel';
import { CurrencySelect } from '@/ui/pickers';
import { LANGUAGES } from '@/i18n';
import { completeSecondFactor, login, registerClient, startSession, setAccessPin, switchIdentity } from '@/core/security/auth';
import { openAccount, GL } from '@/core/banking/accounts';
import { execute } from '@/core/banking/engine';
import { issueCard } from '@/core/banking/cards';
import { asActor, SYSTEM_ACTOR, primaryRole } from '@/core/context';
import { toMinor } from '@/core/currency/format';
import { quote } from '@/core/currency/rates';
import { DEMO_PASSWORD, STAFF_PASSWORD, DEMO_PIN } from '@/core/seed/seed';
import { db as database } from '@/core/db/db';
import type { Lang, ThemeId, User } from '@/core/types';

export function BootScreen({ pct, label, error }: { pct: number; label: string; error?: string }) {
  const { tx } = useT();
  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="stack" style={{ justifyItems: 'center', textAlign: 'center', maxWidth: 520 }}>
        <div style={{ position: 'relative', width: 180, height: 180, display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>
          <RuneSigil size={180} className="" />
          <div style={{ position: 'absolute' }}><Crest size={78} /></div>
        </div>
        <h1 style={{ fontSize: '2rem' }}>{tx('seed.title')}</h1>
        <p className="ink2">{tx('seed.sub')}</p>
        <div className="progress" style={{ width: 320, maxWidth: '80vw' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={tx('seed.title')}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="small muted" aria-live="polite">{tx(label)} · {pct}%</div>
        {error && <Alert tone="negative">{error}</Alert>}
      </div>
    </div>
  );
}

function GateFrame({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const { t } = useT();
  const ui = useUI();
  return (
    <div className="gate" style={{ minHeight: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', placeItems: 'center', padding: '24px 16px' }}>
      <div className="grid" style={{ width: 'min(1060px, 100%)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 22, alignItems: 'start' }}>
        <div className="panel ornate" style={{ padding: '28px 26px' }}>
          <div className="row" style={{ gap: 14, marginBottom: 18 }}>
            <Crest size={56} motto />
            <div>
              <div className="eyebrow">{t('app.state')}</div>
              <h1 style={{ fontSize: '2rem', fontFamily: 'var(--f-engraved)', letterSpacing: '0.12em' }}>{t('app.name').toUpperCase()}</h1>
              <div className="small ink2">{t('app.tagline')}</div>
            </div>
          </div>
          {children}
          <div className="row" style={{ marginTop: 18, justifyContent: 'space-between' }}>
            <div className="row" role="group" aria-label={t('common.language')}>
              {LANGUAGES.map((l) => (
                <button key={l.code} type="button" className={`btn btn-sm${ui.lang === l.code ? ' btn-primary' : ' btn-ghost'}`} onClick={() => ui.setLang(l.code)} lang={l.code}>{l.nativeName}</button>
              ))}
            </div>
            <Badge tone="warning">{t('common.demoBadge')}</Badge>
          </div>
        </div>
        {aside}
      </div>
    </div>
  );
}

export function Login({ onOnboard }: { onOnboard: () => void }) {
  const { t, tx } = useT();
  const setUser = useSession((s) => s.setUser);
  const ui = useUI();
  const [id, setId] = useState('ALD-C-104701');
  const [pw, setPw] = useState(DEMO_PASSWORD);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const identities = useLive(() => db.users.toArray().then((us) => us.filter((u) => u.kind === 'staff' || ['USR-AURELIA', 'USR-MIRELA', 'USR-IMOGEN', 'USR-BARNABY', 'USR-CORVIN', 'USR-TATEV', 'USR-CASPIAN', 'USR-SERAPHINA'].includes(u.id))), [], [] as User[]);

  const finish = (u: User) => {
    ui.applyPreferences({ lang: ui.lang, theme: u.preferences.theme, baseCurrency: u.preferences.baseCurrency });
    setUser(u);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (pending) {
        finish(await completeSecondFactor(pending, code));
      } else {
        const r = await login(id, pw);
        if (r.status === 'second_factor') setPending(r.userId);
        else finish(r.user);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const quick = async (u: User) => {
    setBusy(true);
    setError(null);
    try {
      finish(await switchIdentity(u.id));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateFrame
      aside={
        <div className="panel">
          <header className="panel-head"><div><h2 className="panel-title"><Sparkles size={17} />{t('auth.demoIdentities')}</h2><div className="panel-sub">{t('auth.demoIdentitiesSub')}</div></div></header>
          <div className="list">
            {identities.map((u) => (
              <button key={u.id} type="button" className="list-item" onClick={() => quick(u)} disabled={busy}>
                <Avatar name={u.name} hue={u.avatarHue} />
                <div className="li-main">
                  <div className="li-title">{u.name}</div>
                  <div className="li-sub">{u.clientId} · {u.occupation}</div>
                </div>
                <Badge tone={u.kind === 'staff' ? 'magic' : 'neutral'}>{tx(`role.${primaryRole(u.roles)}`)}</Badge>
              </button>
            ))}
          </div>
          <div className="panel-foot" style={{ justifyContent: 'flex-start' }}>
            <div className="xsmall muted">{t('auth.credentials', { client: DEMO_PASSWORD, staff: STAFF_PASSWORD, pin: DEMO_PIN })}</div>
          </div>
        </div>
      }
    >
      <form className="stack" onSubmit={submit} noValidate>
        <h2 style={{ fontSize: '1.5rem' }}>{pending ? t('auth.secondFactor') : t('auth.signIn')}</h2>
        {!pending ? (
          <>
            <Field label={t('auth.identifier')} htmlFor="login-id" hint={t('auth.identifierHint')}>
              <Input id="login-id" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" required />
            </Field>
            <Field label={t('common.password')} htmlFor="login-pw">
              <Input id="login-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
            </Field>
          </>
        ) : (
          <Field label={t('auth.totpCode')} htmlFor="login-totp" hint={t('auth.totpHint')}>
            <Input id="login-totp" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          </Field>
        )}
        {error ? <ErrorPanel error={error} /> : null}
        <Button type="submit" variant="primary" size="lg" icon={pending ? <KeyRound /> : <LogIn />} loading={busy} block>{pending ? t('common.verify') : t('auth.signIn')}</Button>
        {pending && <Button variant="ghost" onClick={() => setPending(null)}>{t('common.back')}</Button>}
        <div className="rule">{t('auth.or')}</div>
        <Button icon={<UserPlus />} onClick={onOnboard} block>{t('auth.becomeClient')}</Button>
      </form>
    </GateFrame>
  );
}

/* ───────────── Onboarding ───────────── */

const STEPS = ['welcome', 'profile', 'language', 'currency', 'account', 'security', 'done'] as const;
type Step = (typeof STEPS)[number];

export function Onboarding({ onCancel, onSkip }: { onCancel: () => void; onSkip: () => void }) {
  const { t, tx } = useT();
  const ui = useUI();
  const setUser = useSession((s) => s.setUser);
  const [step, setStep] = useState<Step>('welcome');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', city: 'Vellinghast', street: '', occupation: '', dob: '1995-01-01', password: '', password2: '', pin: '', theme: ui.theme as ThemeId, lang: ui.lang as Lang, base: 'CRWN', accountCcy: 'CRWN' });
  const [created, setCreated] = useState<{ user: User; accountNumber: string; card: string } | null>(null);
  const idx = STEPS.indexOf(step);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const profileErrors = {
    name: !form.name.trim() ? t('onboarding.err.name') : '',
    email: !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email) ? t('onboarding.err.email') : '',
    street: !form.street.trim() ? t('onboarding.err.street') : '',
  };
  const secErrors = {
    password: form.password.length < 8 ? t('onboarding.err.password') : form.password !== form.password2 ? t('onboarding.err.match') : '',
    pin: !/^\d{4}$/.test(form.pin) ? t('onboarding.err.pin') : '',
  };
  const [touched, setTouched] = useState(false);

  const next = () => {
    setTouched(true);
    if (step === 'profile' && Object.values(profileErrors).some(Boolean)) return;
    if (step === 'security') {
      if (Object.values(secErrors).some(Boolean)) return;
      void create();
      return;
    }
    setTouched(false);
    setStep(STEPS[idx + 1]);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const user = await registerClient({
        name: form.name, email: form.email, phone: form.phone || '+0 (000) 000-0000', password: form.password, language: form.lang, baseCurrency: form.base, theme: form.theme,
        address: { line1: form.street, city: form.city, province: 'Crown Vale', postal: 'AL1 0NB', realm: 'Sovereign Commonwealth of Aldermoor' }, dob: form.dob, occupation: form.occupation,
      });
      const signed = await startSession(user, 'onboarding');
      await setAccessPin(form.pin);
      const acc = await openAccount({ ownerId: user.id, type: 'current', currency: form.accountCcy, name: t('onboarding.firstAccountName'), multiCurrency: true });
      // welcome grant from the Treasury so the new profile can try every operation
      const grant = quote('CRWN', form.accountCcy, toMinor(2500, 'CRWN')).targetAmount || toMinor(2500, form.accountCcy);
      await asActor(SYSTEM_ACTOR, () => execute({
        draft: { type: 'opening', amount: grant, currency: form.accountCcy, toAccountId: acc.id, sender: { name: t('onboarding.grantSender') }, recipient: { name: user.name, accountNumber: acc.number }, description: t('onboarding.grantDescription'), category: 'income', channel: 'system', refPrefix: 'GRT', partyIds: [user.id] },
        screen: false,
        plan: () => [{ memo: 'Welcome grant', allowOverdraft: true, lines: [{ accountId: GL.EQUITY, currency: form.accountCcy, side: 'D', amount: grant }, { accountId: acc.id, currency: form.accountCcy, side: 'C', amount: grant }] }],
      }));
      const card = await issueCard({ accountId: acc.id, type: 'debit', pin: form.pin });
      await database.users.update(user.id, { onboarded: true });
      setCreated({ user: { ...signed, onboarded: true }, accountNumber: acc.number, card: card.last4 });
      ui.applyPreferences({ lang: form.lang, theme: form.theme, baseCurrency: form.base });
      setStep('done');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateFrame
      aside={
        <div className="panel">
          <header className="panel-head"><h2 className="panel-title"><ShieldCheck size={17} />{t('onboarding.progress')}</h2></header>
          <ol className="timeline" style={{ padding: 18 }}>
            {STEPS.map((s, i) => (
              <li key={s} className={i < idx ? 'ok' : i === idx ? 'current' : 'pending'}>
                <span className="node" aria-hidden>{i < idx ? <Check /> : <span className="xsmall">{i + 1}</span>}</span>
                <div><div className="tl-title">{tx(`onboarding.steps.${s}`)}</div></div>
              </li>
            ))}
          </ol>
        </div>
      }
    >
      <div className="stack" aria-live="polite">
        <div className="eyebrow">{t('onboarding.stepOf', { n: idx + 1, total: STEPS.length })}</div>
        <h2 style={{ fontSize: '1.6rem' }}>{tx(`onboarding.title.${step}`)}</h2>
        {step === 'welcome' && <p className="ink2">{t('onboarding.welcomeText')}</p>}
        {step === 'profile' && (
          <div className="form-grid">
            <Field label={t('onboarding.fullName')} htmlFor="ob-name" required error={touched ? profileErrors.name : ''} className="full"><Input id="ob-name" value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" /></Field>
            <Field label={t('common.email')} htmlFor="ob-email" required error={touched ? profileErrors.email : ''}><Input id="ob-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" /></Field>
            <Field label={t('common.phone')} htmlFor="ob-phone"><Input id="ob-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" /></Field>
            <Field label={t('common.address')} htmlFor="ob-street" required error={touched ? profileErrors.street : ''}><Input id="ob-street" value={form.street} onChange={(e) => set('street', e.target.value)} autoComplete="street-address" /></Field>
            <Field label={t('common.city')} htmlFor="ob-city">
              <Select id="ob-city" value={form.city} onChange={(e) => set('city', e.target.value)}>
                {['Vellinghast', 'Port Elsinmoor', 'Thornbury Cross', 'Gallowmere', 'Ravensreach', 'Silverbridge', 'Oakhallow', 'Brightwater Spa', 'Kestrel Fen', 'Hollowmere'].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label={t('onboarding.dob')} htmlFor="ob-dob"><Input id="ob-dob" type="date" value={form.dob} onChange={(e) => set('dob', e.target.value)} /></Field>
            <Field label={t('onboarding.occupation')} htmlFor="ob-occ"><Input id="ob-occ" value={form.occupation} onChange={(e) => set('occupation', e.target.value)} /></Field>
          </div>
        )}
        {step === 'language' && (
          <div className="stack">
            <div className="grid cols-3">
              {LANGUAGES.map((l) => (
                <button key={l.code} type="button" className="qa" aria-pressed={form.lang === l.code} style={form.lang === l.code ? { borderColor: 'var(--accent)' } : undefined} onClick={() => { set('lang', l.code); ui.setLang(l.code); }} lang={l.code}>
                  <strong style={{ fontSize: '1rem' }}>{l.nativeName}</strong><span className="muted">{l.name}</span>
                </button>
              ))}
            </div>
            <div className="grid cols-2">
              {(['ministry', 'classic', 'night', 'modern'] as ThemeId[]).map((th) => (
                <button key={th} type="button" className="qa" aria-pressed={form.theme === th} style={{ justifyItems: 'start', textAlign: 'left', borderColor: form.theme === th ? 'var(--accent)' : undefined }} onClick={() => { set('theme', th); ui.setTheme(th); }}>
                  <strong>{tx(`theme.${th}`)}</strong><span className="muted">{tx(`themeDesc.${th}`)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 'currency' && (
          <div className="form-grid">
            <Field label={t('common.baseCurrency')} htmlFor="ob-base" hint={t('onboarding.baseHint')}><CurrencySelect id="ob-base" value={form.base} onChange={(v) => set('base', v)} /></Field>
          </div>
        )}
        {step === 'account' && (
          <div className="stack">
            <p className="ink2">{t('onboarding.accountText')}</p>
            <Field label={t('onboarding.accountCurrency')} htmlFor="ob-acc"><CurrencySelect id="ob-acc" value={form.accountCcy} onChange={(v) => set('accountCcy', v)} /></Field>
            <Alert tone="magic">{t('onboarding.grantNote')}</Alert>
          </div>
        )}
        {step === 'security' && (
          <div className="form-grid">
            <Field label={t('common.password')} htmlFor="ob-pw" required error={touched ? secErrors.password : ''} hint={t('onboarding.passwordHint')}><Input id="ob-pw" type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></Field>
            <Field label={t('onboarding.repeatPassword')} htmlFor="ob-pw2" required><Input id="ob-pw2" type="password" value={form.password2} onChange={(e) => set('password2', e.target.value)} autoComplete="new-password" /></Field>
            <Field label={t('onboarding.cardPin')} htmlFor="ob-pin" required error={touched ? secErrors.pin : ''} hint={t('onboarding.pinHint')}><Input id="ob-pin" inputMode="numeric" maxLength={4} value={form.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} autoComplete="off" /></Field>
          </div>
        )}
        {step === 'done' && created && (
          <div className="stack">
            <Alert tone="positive" title={t('onboarding.doneTitle')}>{t('onboarding.doneText', { clientId: created.user.clientId, number: created.accountNumber, last4: created.card })}</Alert>
            <Button variant="primary" size="lg" icon={<ArrowRight />} onClick={() => setUser(created.user)}>{t('onboarding.enter')}</Button>
          </div>
        )}
        {error ? <ErrorPanel error={error} /> : null}
        {step !== 'done' && (
          <div className="row-between">
            <div className="row">
              {idx > 0 ? <Button icon={<ArrowLeft />} onClick={() => setStep(STEPS[idx - 1])}>{t('common.back')}</Button> : <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>}
              <Button variant="ghost" onClick={onSkip}>{t('onboarding.skip')}</Button>
            </div>
            <Button variant="primary" icon={<ArrowRight />} onClick={next} loading={busy}>{step === 'security' ? t('onboarding.create') : t('common.continue')}</Button>
          </div>
        )}
      </div>
    </GateFrame>
  );
}
