'use client';

interface UserAvatarProps {
  name: string;
  avatar?: string;   // hex color string like "#8b5cf6"
  photoUrl?: string; // actual photo URL
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function UserAvatar({ name, avatar, photoUrl, size = 'md', className = '' }: UserAvatarProps) {
  const sizes = { sm: 'w-7 h-7 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-14 h-14 text-xl' };
  const initials = name?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?';

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className={`${sizes[size]} rounded-full object-cover flex-shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      className={`${sizes[size]} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0 ${className}`}
      style={{ backgroundColor: avatar || '#6366f1' }}
    >
      {initials}
    </div>
  );
}
