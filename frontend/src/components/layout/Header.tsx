import { Bell } from "lucide-react";
import { NavLink } from "react-router-dom";

const Header = () => {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-white px-8">
      {/* Logo */}
      <div className="flex items-center gap-8">
        <NavLink
          to="/"
          className="text-lg font-semibold tracking-tight text-gray-900"
        >
          FLOW
        </NavLink>

        {/* Navigation */}
        <nav className="flex items-center gap-1">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              }`
            }
          >
            Dashboard
          </NavLink>

          <NavLink
            to="/jobs"
            className={({ isActive }) =>
              `rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              }`
            }
          >
            Jobs
          </NavLink>
        </nav>
      </div>

      {/* Right side */}
      <button className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900">
        <Bell size={19} />
      </button>
    </header>
  );
};

export default Header;