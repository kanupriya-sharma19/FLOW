import { NavLink } from "react-router-dom";

const Header = () => {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand-nav">
          <NavLink to="/" className="brand" aria-label="FLOW home">
    
            FLOW
          </NavLink>
        </div>

        <div className="topbar-spacer" aria-hidden="true" />
      </div>
    </header>
  );
};

export default Header;
