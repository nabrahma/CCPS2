/** The app's icons: solid 16 px glyphs in the current text colour. */
import type { ReactNode } from 'react';

function Glyph({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}

export const BoltIcon = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M9.4 1 3 9.2h4L6.3 15l6.7-8.4H8.8z" />
  </Glyph>
);

export const PanelIcon = () => (
  <Glyph>
    <path fillRule="evenodd" d="M2.5 2h11A1.5 1.5 0 0 1 15 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9A1.5 1.5 0 0 1 2.5 2Zm.0 1.3a.2.2 0 0 0-.2.2v9c0 .1.1.2.2.2H5V3.3Zm3.8 0v9.4h7.2a.2.2 0 0 0 .2-.2v-9a.2.2 0 0 0-.2-.2Z" />
  </Glyph>
);

export const BodyIcon = () => (
  <Glyph>
    <circle cx="8" cy="3.2" r="2.2" />
    <path d="M3 8.6C3 7 4.3 6.2 5.8 6.2h4.4C11.7 6.2 13 7 13 8.6V10h-2.4v5H5.4v-5H3z" />
  </Glyph>
);

export const FaceIcon = () => (
  <Glyph>
    <path fillRule="evenodd" d="M8 1c3 0 5 2.2 5 5.2 0 4.3-2.6 8.8-5 8.8s-5-4.5-5-8.8C3 3.2 5 1 8 1ZM5.9 5.7a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Zm4.2 0a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z" />
  </Glyph>
);

export const SkinIcon = () => (
  <Glyph>
    <path d="M8 1.2c2.8 3.3 4.8 5.8 4.8 8.2a4.8 4.8 0 0 1-9.6 0c0-2.4 2-4.9 4.8-8.2Z" />
  </Glyph>
);

export const HairIcon = () => (
  <Glyph>
    <path d="M2 2.5h12V7h-1.3v6.5h-1.7V7h-1.2v6.5H8.1V7H6.9v6.5H5.2V7H4v6.5H2.3V7H2z" />
  </Glyph>
);

export const WardrobeIcon = () => (
  <Glyph>
    <path d="M5.4 1.8 1 4.5l1.5 3.2 1.7-.8v7.3h7.6V6.9l1.7.8L15 4.5l-4.4-2.7a2.7 2.7 0 0 1-5.2 0Z" />
  </Glyph>
);

export const ExpressionIcon = () => (
  <Glyph>
    <path fillRule="evenodd" d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1ZM5.5 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM4.2 9.3c.6 1.9 2 3 3.8 3s3.2-1.1 3.8-3l-1.2-.4c-.5 1.4-1.4 2.1-2.6 2.1s-2.1-.7-2.6-2.1Z" />
  </Glyph>
);

export const ExportIcon = () => (
  <Glyph>
    <path d="M8 1 12.2 5.5h-2.7v5h-3v-5H3.8zM2 12h12v2.5H2z" />
  </Glyph>
);

export const CharactersIcon = () => (
  <Glyph>
    <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" />
  </Glyph>
);

export const SlidersIcon = ({ size = 12 }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M1 3h7.2a2 2 0 0 1 3.6 0H15v1.6h-3.2a2 2 0 0 1-3.6 0H1zM1 11.4h3.2a2 2 0 0 1 3.6 0H15V13H7.8a2 2 0 0 1-3.6 0H1z" />
  </Glyph>
);

export const InspectIcon = ({ size = 12 }: { size?: number }) => (
  <Glyph size={size}>
    <path fillRule="evenodd" d="M7.2 0h1.6v2.1a6 6 0 0 1 5.1 5.1H16v1.6h-2.1a6 6 0 0 1-5.1 5.1V16H7.2v-2.1a6 6 0 0 1-5.1-5.1H0V7.2h2.1a6 6 0 0 1 5.1-5.1Zm.8 3.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8ZM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
  </Glyph>
);

export const ShuffleIcon = ({ size = 12 }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M11.5 1 15 4l-3.5 3V5h-1.1L5.9 12H1v-1.7h4l4.5-7h2zM1 3.3h4L6.7 6l-1 1.5L4.1 5H1zM11.5 9l3.5 3-3.5 3v-2h-3L6.8 10.5l1-1.5 1.6 2.3h2.1z" />
  </Glyph>
);

export const LockIcon = ({ size = 12 }: { size?: number }) => (
  <Glyph size={size}>
    <path fillRule="evenodd" d="M8 1a3.5 3.5 0 0 1 3.5 3.5V7H13v8H3V7h1.5V4.5A3.5 3.5 0 0 1 8 1Zm0 1.6a1.9 1.9 0 0 0-1.9 1.9V7h3.8V4.5A1.9 1.9 0 0 0 8 2.6Z" />
  </Glyph>
);

export const ResetIcon = ({ size = 12 }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M7 1v2.1A5.5 5.5 0 1 1 2.5 8.6h1.7A3.9 3.9 0 1 0 7 4.7v2.1L3 3.9z" />
  </Glyph>
);

/** The PS2CC mark: three nested rings, like a disc seen at an angle. */
export const LookIcon = () => (
  <Glyph>
    <path d="M8 4.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6ZM7.3 0h1.4v2.6H7.3zm0 13.4h1.4V16H7.3zM0 7.3h2.6v1.4H0zm13.4 0H16v1.4h-2.6zM2.1 3.1l1-1 1.8 1.8-1 1zm9 9 1-1 1.8 1.8-1 1zM2.1 12.9l1.8-1.8 1 1-1.8 1.8zm9-9 1.8-1.8 1 1-1.8 1.8z" />
  </Glyph>
);

export const LibraryIcon = () => (
  <Glyph>
    <path d="M1.5 1.5h5.5v5.5H1.5zm7.5 0h5.5v5.5H9zM1.5 9h5.5v5.5H1.5zM9 9h5.5v5.5H9z" />
  </Glyph>
);

export const StudioIcon = () => (
  <Glyph>
    <path d="M13.8 1.2a1.3 1.3 0 0 1 1 2.2L8.6 9.6 6.4 7.4l6.2-6.2a1.3 1.3 0 0 1 1.2 0ZM5.6 8.4l2 2c-.2 2.4-2 4.1-4.6 4.4L1 15l.4-1.6c.7-.5 1-1.2 1-2.2 0-1.6 1.5-2.8 3.2-2.8Z" />
  </Glyph>
);

export const StarIcon = ({ filled }: { filled: boolean }) => (
  <Glyph>
    <path
      fillRule="evenodd"
      d={filled ? 'M8 1l2.1 4.5 4.9.6-3.6 3.4.9 4.9L8 12l-4.3 2.4.9-4.9L1 6.1l4.9-.6z' : 'M8 1l2.1 4.5 4.9.6-3.6 3.4.9 4.9L8 12l-4.3 2.4.9-4.9L1 6.1l4.9-.6Zm0 2.9L6.8 6.6l-2.9.4 2.1 2-.5 2.9L8 10.5l2.5 1.4-.5-2.9 2.1-2-2.9-.4Z'}
    />
  </Glyph>
);

export const NewIcon = () => (
  <Glyph>
    <path d="M3.5 1h6l3.5 3.5V15h-9.5zm1.3 1.3v11.4h6.9V5.3H8.7v-3zM7.4 7h1.2v1.9h1.9v1.2H8.6V12H7.4v-1.9H5.5V8.9h1.9z" />
  </Glyph>
);

export const OpenIcon = () => (
  <Glyph>
    <path d="M1 3h5l1.4 1.5H15V14H1zm1.3 2.8v6.9h11.4V5.8z" />
  </Glyph>
);

export const SaveIcon = () => (
  <Glyph>
    <path d="M2 2h9.6L14 4.4V14H2zm1.3 1.3v9.4h9.4V5L11 3.3H10v3H4.5v-3zm2.5 0v1.8h2.9V3.3zM5 9h6v3H5z" />
  </Glyph>
);

export const UndoIcon = () => (
  <Glyph>
    <path d="M5.2 3.2 1.4 7l3.8 3.8.9-.9L3.9 7.6h5.6a3.2 3.2 0 0 1 0 6.4H7.6v1.3h1.9a4.5 4.5 0 0 0 0-9H3.9l2.2-2.3z" />
  </Glyph>
);

export const RedoIcon = () => (
  <Glyph>
    <path d="m10.8 3.2 3.8 3.8-3.8 3.8-.9-.9 2.2-2.3H6.5a3.2 3.2 0 0 0 0 6.4h1.9v1.3H6.5a4.5 4.5 0 0 1 0-9h5.6L9.9 4.1z" />
  </Glyph>
);

export const GearIcon = () => (
  <Glyph>
    <path fillRule="evenodd" d="M6.9 1h2.2l.4 1.9 1.1.5 1.6-1.1 1.6 1.6-1.1 1.6.5 1.1L15 6.9v2.2l-1.9.4-.5 1.1 1.1 1.6-1.6 1.6-1.6-1.1-1.1.5L9.1 15H6.9l-.4-1.9-1.1-.5-1.6 1.1-1.6-1.6 1.1-1.6-.5-1.1L1 9.1V6.9l1.9-.4.5-1.1-1.1-1.6 1.6-1.6 1.6 1.1 1.1-.5ZM8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z" />
  </Glyph>
);

export const EyeIcon = ({ off }: { off: boolean }) => (
  <Glyph>
    {off ? (
      <path d="M2.3 1.4 14.6 13.7l-.9.9-2.2-2.2A7.4 7.4 0 0 1 8 13.3C4.6 13.3 2 10.6 1 8c.5-1.2 1.3-2.4 2.4-3.4L1.4 2.3zM4.3 5.5C3.5 6.2 2.9 7.1 2.5 8c.9 2 3 4 5.5 4 1 0 1.8-.3 2.6-.7L9.4 10.1a2.4 2.4 0 0 1-3.5-3.5zM8 2.7c3.4 0 6 2.7 7 5.3-.4 1-1 2-1.8 2.8l-.9-.9c.5-.6 1-1.2 1.2-1.9-.9-2-3-4-5.5-4-.6 0-1.1.1-1.6.3l-1-1A7 7 0 0 1 8 2.7z" />
    ) : (
      <path fillRule="evenodd" d="M8 2.7c3.4 0 6 2.7 7 5.3-1 2.6-3.6 5.3-7 5.3S2 10.6 1 8c1-2.6 3.6-5.3 7-5.3Zm0 1.3C5.5 4 3.4 6 2.5 8c.9 2 3 4 5.5 4s4.6-2 5.5-4c-.9-2-3-4-5.5-4Zm0 1.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8Z" />
    )}
  </Glyph>
);

export const HeartIcon = ({ filled }: { filled: boolean }) => (
  <Glyph>
    <path
      fillRule="evenodd"
      d={filled ? 'M8 14.2 2 8.3A3.6 3.6 0 0 1 8 3.7a3.6 3.6 0 0 1 6 4.6z' : 'M8 14.2 2 8.3A3.6 3.6 0 0 1 8 3.7a3.6 3.6 0 0 1 6 4.6Zm0-1.8 5-5a2.3 2.3 0 0 0-4-2.4l-1 1.2-1-1.2a2.3 2.3 0 0 0-4 2.4Z'}
    />
  </Glyph>
);

export function BrandMark() {
  return (
    <svg className="brand-mark" width="28" height="14" viewBox="0 0 28 14" fill="none" stroke="currentColor" strokeWidth="1.3" role="img" aria-label="PS2CC">
      <ellipse cx="14" cy="7" rx="13" ry="6" />
      <ellipse cx="14" cy="7" rx="9" ry="4" />
      <ellipse cx="14" cy="7" rx="5" ry="2" />
    </svg>
  );
}
