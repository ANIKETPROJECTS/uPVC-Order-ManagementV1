import windowMark from '@/assets/window-mark.svg';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center ${compact ? 'gap-2' : 'gap-3'}`}>
      <img src={windowMark} alt="" className={compact ? 'h-8 w-8' : 'h-10 w-10'} aria-hidden="true" />
      <div className="min-w-0">
        <p className={`font-display font-bold tracking-[-0.03em] ${compact ? 'text-sm' : 'text-base'}`}>Framewise</p>
        {!compact && <p className="text-[10px] uppercase tracking-[0.2em] text-current opacity-45">Order operations</p>}
      </div>
    </div>
  );
}