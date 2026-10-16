// The folded O: a closed reading space with one page turned inward.
export function Brand({ compact = false }: { compact?: boolean }) {
    return (
        <span className={`brand${compact ? " brand-compact" : ""}`} aria-label="Otium">
            <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
                <path fill="currentColor" fillRule="evenodd" d="M32 6C17 6 7 17 7 32s10 26 25 26l25-25C57 17 47 6 32 6Zm0 9c10 0 16 7 16 17H33v17c-10 1-17-6-17-17 0-10 6-17 16-17Z" />
            </svg>
            {!compact && <span className="brand-name" aria-hidden="true">otium</span>}
        </span>
    );
}
