import { Bell } from "lucide-react";

const Header = () => {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-white px-8">
      <div>
        <p className="text-sm text-gray-500">Distributed Job Platform</p>
      </div>

      <button className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
        <Bell size={20} />
      </button>
    </header>
  );
};

export default Header;