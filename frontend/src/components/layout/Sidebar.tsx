import { NavLink } from "react-router-dom";
import { LayoutDashboard, ListTodo, Server } from "lucide-react";

const Sidebar = () => {
  return (
    <aside className="fixed left-0 top-0 h-screen w-64 border-r bg-white px-4 py-6">
      <div className="mb-10 px-3">
        <h1 className="text-2xl font-bold tracking-tight">FLOW</h1>
        <p className="mt-1 text-sm text-gray-500">Job Scheduler</p>
      </div>

      <nav className="space-y-1">
        <NavLink
          to="/"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
              isActive
                ? "bg-gray-100 text-gray-900"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            }`
          }
        >
          <LayoutDashboard size={18} />
          Dashboard
        </NavLink>

        <NavLink
          to="/jobs"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
              isActive
                ? "bg-gray-100 text-gray-900"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            }`
          }
        >
          <ListTodo size={18} />
          Jobs
        </NavLink>

        <NavLink
          to="/workers"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
              isActive
                ? "bg-gray-100 text-gray-900"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            }`
          }
        >
          <Server size={18} />
          Workers
        </NavLink>
      </nav>
    </aside>
  );
};

export default Sidebar;