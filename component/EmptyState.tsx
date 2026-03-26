interface Props {
  icon?: string;
  title: string;
  description?: string;
  action?: { label: string; href: string; };
}
export default function EmptyState({ icon = "◎", title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="text-5xl mb-5 text-[#2a2a2a]">{icon}</div>
      <h3 className="text-white text-base font-semibold mb-1">{title}</h3>
      {description && <p className="text-[#555] text-sm max-w-xs">{description}</p>}
      {action && (
        <a href={action.href} className="btn-primary mt-6 text-sm">
          {action.label}
        </a>
      )}
    </div>
  );
}
