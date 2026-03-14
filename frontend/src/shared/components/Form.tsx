export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="form-row">{children}</div>;
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'gold' | 'ghost' | 'danger' | 'success' }) {
  const { variant = 'ghost', className = '', ...rest } = props;
  return <button className={`btn btn-${variant} ${className}`.trim()} {...rest} />;
}
