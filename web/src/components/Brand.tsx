// The folded O: a closed reading space with one page turned inward.
export function Brand({ compact = false }: { compact?: boolean }) {
    return (
        <span className={`brand${compact ? " brand-compact" : ""}`} aria-label="Otium">
            <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
                <path fill="currentColor" fillRule="evenodd" d="M32 6C17 6 7 17 7 32s10 26 25 26 25-11 25-26L32 6Zm-1 10v17h17c0 10-6 16-16 16S16 42 16 32s6-16 15-16Z" />
            </svg>
            {!compact && <span className="brand-name" aria-hidden="true">otium</span>}
        </span>
    );
}
