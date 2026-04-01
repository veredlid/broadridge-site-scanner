import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  /** Text to show in the tooltip. Falsy → tooltip disabled, children rendered as-is. */
  content: string | null | undefined;
  children: React.ReactNode;
  /** Extra classes applied to the trigger wrapper div */
  className?: string;
}

/**
 * Instant, styled tooltip rendered via a React portal so it's never clipped by
 * overflow-hidden containers (tables, cards, etc.).
 *
 * Design: blue background, 3-D glow shadow, white text, downward arrow.
 * Appearance: zero delay — shows on mouseenter, hides on mouseleave.
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  const [coords, setCoords] = useState<{ top: number; left: number; below?: boolean } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  if (!content) return <>{children}</>;

  const handleMouseEnter = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // Show above unless < 120px from top — then show below
    const showBelow = rect.top < 120;
    setCoords({
      top: showBelow ? rect.bottom + 12 : rect.top - 12,
      left: rect.left + rect.width / 2,
      below: showBelow,
    });
  };

  return (
    <>
      <div
        ref={triggerRef}
        className={className}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setCoords(null)}
      >
        {children}
      </div>

      {coords !== null &&
        createPortal(
          <div
            className="fixed z-[9999] pointer-events-none"
            style={{
              top: coords.top,
              left: coords.left,
              transform: coords.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            }}
          >
            {/* Arrow — above bubble when showing below trigger */}
            {coords.below && (
              <div className="flex justify-center mb-px">
                <div
                  className="w-0 h-0"
                  style={{
                    borderLeft: '6px solid transparent',
                    borderRight: '6px solid transparent',
                    borderBottom: '7px solid #1d4ed8',
                    filter: 'drop-shadow(0 -2px 3px rgba(29,78,216,0.4))',
                  }}
                />
              </div>
            )}
            {/* Bubble */}
            <div
              style={{
                padding: '9px 14px',
                borderRadius: '9px',
                fontSize: '14px',
                fontWeight: 500,
                lineHeight: 1.55,
                color: '#fff',
                maxWidth: '480px',
                wordBreak: 'break-word',
                whiteSpace: 'normal',
                textAlign: 'left',
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                boxShadow:
                  '0 10px 28px rgba(37,99,235,0.6), 0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.2)',
                border: '1px solid rgba(147,197,253,0.35)',
              }}
            >
              {content}
            </div>
            {/* Arrow — below bubble when showing above trigger */}
            {!coords.below && (
              <div className="flex justify-center -mt-px">
                <div
                  className="w-0 h-0"
                  style={{
                    borderLeft: '6px solid transparent',
                    borderRight: '6px solid transparent',
                    borderTop: '7px solid #1d4ed8',
                    filter: 'drop-shadow(0 3px 4px rgba(29,78,216,0.4))',
                  }}
                />
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
