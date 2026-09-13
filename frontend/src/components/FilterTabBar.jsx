export default function FilterTabBar({ activeTab, onTabChange, counts = {} }) {
  const tabs = [
    { id: 'all', label: 'All', count: counts.all || 0 },
    { id: 'contacts', label: 'Contacts', count: counts.contacts || 0 },
    { id: 'groups', label: 'Groups', count: counts.groups || 0 },
  ];

  return (
    <div className="filter-tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`filter-pill-tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          <span>{tab.label}</span>
          {tab.count > 0 && <span className="tab-count-badge">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
