export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-50 text-gray-900" style={{ colorScheme: "light" }}>
      {children}
    </div>
  );
}
