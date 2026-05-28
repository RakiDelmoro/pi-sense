import '../styles/header.css';

export function Header() {
  return (
    <header class="dashboard-header">
      <div class="header">
        <div class="header-logo-container">
          <img class="header-logo" src="/public/logo.png" alt="Pi" />
          <span class="header-logo-text">Sense</span>
        </div>
      </div>
    </header>
  );
}
