(() => {
  "use strict";

  // Available semesters / word sets. The first entry is the default and keeps
  // the legacy (un-suffixed) storage keys so existing progress is preserved.
  const SEMESTERS = [
    { id: "4a", label: "四年级上册", file: "words.json", maxDay: 21 },
    {
      id: "4b",
      label: "四年级下册",
      file: "words.4b.json",
      maxDay: 20,
      // 下册按教材的“单元-课时”命名（1-1、1-2 ……），下标为 day-1。
      dayLabels: [
        "1-1", "1-2", "1-3", "1-4",
        "2-1", "2-2", "2-3", "2-4",
        "3-1", "3-2",
        "4-1", "4-2", "4-3",
        "5-1", "5-2", "5-3", "5-4",
        "6-1", "6-2", "6-3",
      ],
    },
  ];

  const STORAGE_KEY = "wg-semester";

  function readId() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      if (SEMESTERS.some((s) => s.id === value)) {
        return value;
      }
    } catch (err) {
      // ignore storage errors
    }
    return SEMESTERS[0].id;
  }

  function current() {
    const id = readId();
    return SEMESTERS.find((s) => s.id === id) || SEMESTERS[0];
  }

  function setId(id) {
    if (!SEMESTERS.some((s) => s.id === id)) {
      return false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch (err) {
      // ignore storage errors
    }
    return true;
  }

  // Suffix appended to per-semester storage keys. The default semester keeps
  // the original key names so previously saved progress keeps working.
  function keySuffix() {
    const id = readId();
    return id === SEMESTERS[0].id ? "" : "-" + id;
  }

  window.WG = {
    SEMESTERS,
    STORAGE_KEY,
    id: readId,
    current,
    setId,
    label: () => current().label,
    wordsFile: () => current().file,
    maxDay: () => current().maxDay,
    keySuffix,
    // Namespace a base storage key for the active semester.
    key: (base) => base + keySuffix(),
    // Display name for a level. 上册 -> "Day 5"，下册 -> "1-1"。
    dayLabel: (day) => {
      const labels = current().dayLabels;
      if (labels && labels[day - 1]) {
        return labels[day - 1];
      }
      return "Day " + day;
    },
  };
})();
