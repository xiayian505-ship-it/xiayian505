(function (global) {
  "use strict";

  const APP = "cycle";
  const STORAGE_NAMESPACE = "cycle-records";
  const SETTINGS_KEY = "cycle:settings";
  const DEFAULT_SETTINGS = Object.freeze({
    cycleLength: 28,
    periodLength: 5
  });

  const state = {
    selectedDate: "",
    records: [],
    settings: loadSettings(),
    calendar: null,
    interaction: null,
    tabs: null,
    crud: null,
    collection: null,
    customFieldInstances: [],
    predictedDates: new Set(),
    averages: {
      cycle: null,
      period: null
    }
  };

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function todayKey(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function parseDateKey(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utc = Date.UTC(year, month - 1, day);
    const date = new Date(utc);

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return { year, month, day, utc, key: `${year}-${pad2(month)}-${pad2(day)}` };
  }

  function addDays(dateKey, amount) {
    const parsed = parseDateKey(dateKey);
    if (!parsed) return "";

    const date = new Date(parsed.utc + Number(amount || 0) * 86400000);
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  }

  function daysBetween(startKey, endKey) {
    const start = parseDateKey(startKey);
    const end = parseDateKey(endKey);
    if (!start || !end) return null;
    return Math.round((end.utc - start.utc) / 86400000);
  }

  function inclusiveDays(startKey, endKey) {
    const diff = daysBetween(startKey, endKey);
    return diff == null || diff < 0 ? null : diff + 1;
  }

  function dateRange(startKey, endKey) {
    const start = parseDateKey(startKey);
    const end = parseDateKey(endKey);
    if (!start || !end || end.utc < start.utc) return [];

    const result = [];
    for (let cursor = start.utc; cursor <= end.utc; cursor += 86400000) {
      const d = new Date(cursor);
      result.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);
    }
    return result;
  }

  function formatDateRange(startKey, endKey) {
    if (!startKey) return "—";
    if (!endKey || endKey === startKey) return startKey;
    return `${startKey} ～ ${endKey}`;
  }

  function formatAverage(value) {
    if (!Number.isFinite(value)) return "—";
    const rounded = Math.round(value * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} 天`;
  }

  function average(values) {
    const valid = values.filter(Number.isFinite);
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  function normalizeSettings(raw) {
    const cycleLength = Number(raw?.cycleLength);
    const periodLength = Number(raw?.periodLength);

    return {
      cycleLength: Number.isFinite(cycleLength) && cycleLength > 0
        ? Math.round(cycleLength)
        : DEFAULT_SETTINGS.cycleLength,
      periodLength: Number.isFinite(periodLength) && periodLength > 0
        ? Math.round(periodLength)
        : DEFAULT_SETTINGS.periodLength
    };
  }

  function loadSettings() {
    try {
      const raw = global.localStorage.getItem(SETTINGS_KEY);
      return raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettingsValue(settings) {
    const normalized = normalizeSettings(settings);
    global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    state.settings = normalized;
    return normalized;
  }

  function getPeriodRecords() {
    return state.records
      .filter(record => record?.type === "period" && parseDateKey(record.startDate))
      .slice()
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  }

  function getRecordsForDate(dateKey) {
    return state.records
      .filter(record => {
        if (!record || !parseDateKey(record.startDate)) return false;

        if (record.type === "period" && parseDateKey(record.endDate)) {
          const fromStart = daysBetween(record.startDate, dateKey);
          const toEnd = daysBetween(dateKey, record.endDate);
          return fromStart != null && toEnd != null && fromStart >= 0 && toEnd >= 0;
        }

        return record.startDate === dateKey;
      })
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  function calculateStats() {
    const periods = getPeriodRecords();
    const cycleIntervals = [];

    for (let index = 1; index < periods.length; index += 1) {
      const diff = daysBetween(periods[index - 1].startDate, periods[index].startDate);
      if (Number.isFinite(diff) && diff > 0) cycleIntervals.push(diff);
    }

    const periodLengths = periods
      .map(record => inclusiveDays(record.startDate, record.endDate))
      .filter(value => Number.isFinite(value) && value > 0);

    state.averages.cycle = periods.length >= 3 ? average(cycleIntervals) : null;
    state.averages.period = periodLengths.length >= 3 ? average(periodLengths) : null;

    return {
      periods,
      cycleIntervals,
      periodLengths,
      averageCycle: state.averages.cycle,
      averagePeriod: state.averages.period
    };
  }

  function getPrediction(stats = calculateStats()) {
    const last = stats.periods.at(-1);
    if (!last) return null;

    const startDate = addDays(last.startDate, state.settings.cycleLength);
    if (!startDate) return null;

    const endDate = addDays(startDate, Math.max(1, state.settings.periodLength) - 1);
    return { startDate, endDate };
  }

  async function refreshRecords() {
    state.records = await state.collection.all();
    refreshCalendarMarkers();
    renderSelectedDate();
    renderStats();
    return state.records;
  }

  function collectActualMarkerDates() {
    const dates = new Set();

    state.records.forEach(record => {
      if (!parseDateKey(record?.startDate)) return;

      if (record.type === "period" && parseDateKey(record.endDate)) {
        dateRange(record.startDate, record.endDate).forEach(date => dates.add(date));
      } else {
        dates.add(record.startDate);
      }
    });

    return [...dates];
  }

  function refreshCalendarMarkers() {
    state.interaction?.setMarkers(collectActualMarkerDates());

    const prediction = getPrediction();
    state.predictedDates = new Set(
      prediction ? dateRange(prediction.startDate, prediction.endDate) : []
    );

    applyPredictedCalendarClasses();
  }

  function applyPredictedCalendarClasses() {
    const root = state.calendar?.root;
    if (!root) return;

    root.querySelectorAll(".sc-day[data-calendar-date]").forEach(button => {
      const key = button.dataset.calendarDate || "";
      button.classList.toggle("is-cycle-predicted", state.predictedDates.has(key));
    });
  }

  function recordTypeLabel(record) {
    return record?.type === "period" ? "經期" : "一般紀錄";
  }

  function renderSelectedDate() {
    const label = document.getElementById("selectedDateLabel");
    const list = document.getElementById("selectedDateEvents");
    const addButton = document.getElementById("addSelectedDateRecord");

    if (!label || !list || !addButton) return;

    if (!state.selectedDate) {
      label.textContent = "—";
      list.innerHTML = '<p class="cycle-muted">請先點選月曆日期。</p>';
      addButton.disabled = true;
      return;
    }

    label.textContent = state.selectedDate;
    addButton.disabled = false;

    const records = getRecordsForDate(state.selectedDate);
    list.replaceChildren();

    if (!records.length) {
      const empty = document.createElement("p");
      empty.className = "cycle-muted";
      empty.textContent = "這一天還沒有紀錄。";
      list.append(empty);
      return;
    }

    records.forEach(record => {
      const row = document.createElement("article");
      row.className = "selected-event";

      const main = document.createElement("div");
      main.className = "selected-event-main";

      const title = document.createElement("strong");
      title.textContent = `${recordTypeLabel(record)}｜${formatDateRange(record.startDate, record.endDate)}`;

      const note = document.createElement("span");
      note.textContent = String(record.note || "沒有補充內容");

      const open = document.createElement("button");
      open.type = "button";
      open.className = "cycle-button";
      open.textContent = "查看";
      open.addEventListener("click", async () => {
        state.tabs.show("records");
        await state.crud.openView(record.id);
      });

      main.append(title, note);
      row.append(main, open);
      list.append(row);
    });
  }

  function renderStats() {
    const stats = calculateStats();
    const prediction = getPrediction(stats);

    const avgCycle = document.getElementById("averageCycle");
    const avgPeriod = document.getElementById("averagePeriod");
    const nextPrediction = document.getElementById("nextPrediction");
    const count = document.getElementById("periodRecordCount");
    const history = document.getElementById("periodHistory");
    const applyAverage = document.getElementById("applyAverage");

    avgCycle.textContent = formatAverage(stats.averageCycle);
    avgPeriod.textContent = formatAverage(stats.averagePeriod);

    nextPrediction.textContent = prediction
      ? formatDateRange(prediction.startDate, prediction.endDate)
      : "有第一筆經期紀錄後開始推估";

    count.textContent = `${stats.periods.length} 次`;
    applyAverage.disabled = !(Number.isFinite(stats.averageCycle) || Number.isFinite(stats.averagePeriod));

    history.replaceChildren();

    if (!stats.periods.length) {
      const empty = document.createElement("p");
      empty.className = "cycle-muted";
      empty.textContent = "目前還沒有經期紀錄。";
      history.append(empty);
      return;
    }

    stats.periods
      .slice()
      .reverse()
      .forEach((record, reverseIndex) => {
        const originalIndex = stats.periods.length - 1 - reverseIndex;
        const periodDays = inclusiveDays(record.startDate, record.endDate);
        const cycleDays = originalIndex > 0
          ? daysBetween(stats.periods[originalIndex - 1].startDate, record.startDate)
          : null;

        const row = document.createElement("article");
        row.className = "period-row";

        row.innerHTML = `
          <div class="period-cell">
            <span>日期</span>
            <strong>${formatDateRange(record.startDate, record.endDate)}</strong>
          </div>
          <div class="period-cell">
            <span>這次經期</span>
            <strong>${Number.isFinite(periodDays) ? `${periodDays} 天` : "尚未填結束日"}</strong>
          </div>
          <div class="period-cell">
            <span>距上次開始</span>
            <strong>${Number.isFinite(cycleDays) ? `${cycleDays} 天` : "—"}</strong>
          </div>
        `;

        history.append(row);
      });
  }

  function syncSettingsInputs() {
    document.getElementById("cycleLength").value = String(state.settings.cycleLength);
    document.getElementById("periodLength").value = String(state.settings.periodLength);
  }

  function validateBackupData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    if (!Array.isArray(data.records)) return false;

    const validRecords = data.records.every(record => {
      if (!record || typeof record !== "object") return false;
      if (!parseDateKey(record.startDate)) return false;
      if (!["period", "note"].includes(record.type)) return false;
      if (record.endDate && !parseDateKey(record.endDate)) return false;
      return true;
    });

    if (!validRecords) return false;

    if (data.settings != null) {
      const normalized = normalizeSettings(data.settings);
      if (!Number.isFinite(normalized.cycleLength) || !Number.isFinite(normalized.periodLength)) {
        return false;
      }
    }

    return true;
  }

  function initCalendar() {
    state.calendar = global.SlowlyCalendar.mount("#cycleCalendar", {
      view: "month",
      gridLines: false,
      showLunar: true,
      showFestivals: true,
      showSolarTerms: true
    });

    state.interaction = global.CalendarInteraction.create(state.calendar);

    const interactionRender = state.calendar.render.bind(state.calendar);
    state.calendar.render = function () {
      const result = interactionRender();
      applyPredictedCalendarClasses();
      return result;
    };

    state.calendar.root.addEventListener("click", event => {
      const button = event.target.closest?.(".sc-day[data-calendar-date]");
      if (!button || !state.calendar.root.contains(button)) return;

      const key = button.dataset.calendarDate;
      if (!parseDateKey(key)) return;

      state.selectedDate = key;
      renderSelectedDate();
    }, true);

    state.interaction.subscribe(event => {
      state.selectedDate = event.dateKey;
      renderSelectedDate();
    });

    state.selectedDate = state.interaction.getDateKey() || todayKey();
  }

  function destroyCustomFields() {
    state.customFieldInstances.forEach(instance => {
      try {
        instance?.destroy?.();
      } catch (_) {
        // DataCRUD 會緊接著移除整個表單；這裡只做最佳努力清理。
      }
    });
    state.customFieldInstances = [];
  }

  function initCustomFields() {
    const form = state.crud.formElement;
    if (!form) return;

    destroyCustomFields();

    form.querySelectorAll('input[type="date"]').forEach(input => {
      const instance = global.SlowlyDate?.create?.(input);
      if (instance) state.customFieldInstances.push(instance);
    });

    form.querySelectorAll("select").forEach(select => {
      const instance = global.SlowlySelect?.create?.(select);
      if (instance) state.customFieldInstances.push(instance);
    });
  }

  function initCrud() {
    state.crud = global.SlowlyDataCRUD.create({
      target: "#recordCrud",
      storageKey: STORAGE_NAMESPACE,
      title: "我的紀錄",
      addLabel: "新增紀錄",
      emptyText: "目前還沒有任何紀錄。",
      fields: [
        {
          key: "startDate",
          label: "日期／開始日",
          type: "date",
          required: true
        },
        {
          key: "type",
          label: "類型",
          type: "select",
          required: true,
          defaultValue: "period",
          options: [
            { value: "period", label: "經期" },
            { value: "note", label: "一般紀錄" }
          ]
        },
        {
          key: "endDate",
          label: "結束日",
          type: "date",
          required: false
        },
        {
          key: "note",
          label: "紀錄",
          type: "textarea",
          required: false,
          placeholder: "想記下的感受、狀況或備註"
        }
      ],
      confirmDelete(record) {
        return global.SlowlyConfirm.show({
          title: "刪除這筆紀錄？",
          message: `${record.startDate || "這筆資料"} 刪除後無法復原。`,
          confirmText: "刪除",
          cancelText: "保留",
          className: "cycle-confirm"
        });
      },
      onChange() {
        refreshRecords();
      }
    });

    const store = global.FictionStorage.create({ namespace: STORAGE_NAMESPACE });
    state.collection = store.collection("records");

    const originalRenderFormPanel = state.crud.renderFormPanel.bind(state.crud);
    state.crud.renderFormPanel = function (record) {
      originalRenderFormPanel(record);

      if (!record && state.selectedDate && state.crud.formElement) {
        const startInput = state.crud.formElement.querySelector('[name="startDate"]');
        if (startInput) startInput.value = state.selectedDate;
      }

      initCustomFields();
    };

    const originalClosePanel = state.crud.closePanel.bind(state.crud);
    state.crud.closePanel = function () {
      destroyCustomFields();
      return originalClosePanel();
    };

    const originalSaveForm = state.crud.saveForm.bind(state.crud);
    state.crud.saveForm = async function () {
      const form = state.crud.formElement;
      if (form) {
        const startDate = form.querySelector('[name="startDate"]')?.value || "";
        const endDate = form.querySelector('[name="endDate"]')?.value || "";
        const type = form.querySelector('[name="type"]')?.value || "";

        if (type === "period" && endDate) {
          const diff = daysBetween(startDate, endDate);
          if (diff == null || diff < 0) {
            state.crud.statusElement.textContent = "結束日不能早於開始日。";
            return;
          }
        }
      }

      return originalSaveForm();
    };
  }

  function initTabs() {
    state.tabs = global.SlowlyTabs.create("#outlineTabs");

    state.tabs.root.addEventListener("slowlytabschange", event => {
      if (event.detail?.name === "stats") renderStats();
      if (event.detail?.name === "calendar") applyPredictedCalendarClasses();
    });
  }

  function initPrimaryActions() {
    document.getElementById("addSelectedDateRecord").addEventListener("click", () => {
      if (!state.selectedDate) return;
      state.tabs.show("records");
      const context = document.getElementById("recordContextText");
      context.textContent = state.selectedDate;
      context.hidden = false;
      state.crud.openCreate();
    });

    document.getElementById("saveSettings").addEventListener("click", () => {
      const cycleLength = Number(document.getElementById("cycleLength").value);
      const periodLength = Number(document.getElementById("periodLength").value);
      const status = document.getElementById("settingsStatus");

      if (!Number.isFinite(cycleLength) || cycleLength <= 0 || !Number.isFinite(periodLength) || periodLength <= 0) {
        status.textContent = "週期與經期都要是大於 0 的天數。";
        return;
      }

      saveSettingsValue({ cycleLength, periodLength });
      status.textContent = "設定已儲存。";
      refreshCalendarMarkers();
      renderStats();
    });

    document.getElementById("applyAverage").addEventListener("click", () => {
      const next = {
        cycleLength: Number.isFinite(state.averages.cycle)
          ? Math.round(state.averages.cycle)
          : state.settings.cycleLength,
        periodLength: Number.isFinite(state.averages.period)
          ? Math.round(state.averages.period)
          : state.settings.periodLength
      };

      saveSettingsValue(next);
      syncSettingsInputs();
      document.getElementById("settingsStatus").textContent = "已把目前可用的平均值套進推估設定。";
      refreshCalendarMarkers();
      renderStats();
    });
  }

  function initBackup() {
    global.SlowlyCustomFile.init("#backupFilePicker");

    const fileInput = document.getElementById("backupFile");
    const importButton = document.getElementById("importBackup");
    const status = document.getElementById("backupStatus");

    fileInput.addEventListener("change", () => {
      importButton.disabled = !fileInput.files?.[0];
      status.textContent = "";
    });

    document.getElementById("exportBackup").addEventListener("click", async () => {
      try {
        const records = await state.collection.all();
        const payload = global.DataBackup.createPayload({
          app: APP,
          version: 1,
          data: {
            records,
            settings: state.settings
          }
        });

        global.DataBackup.downloadJson(
          `cycle-backup-${global.DataBackup.todayISO()}.json`,
          payload
        );
        status.textContent = "備份已匯出。";
      } catch (error) {
        console.error(error);
        status.textContent = error?.message || "備份匯出失敗。";
      }
    });

    importButton.addEventListener("click", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      const approved = await global.SlowlyConfirm.show({
        title: "還原這份備份？",
        message: "目前紀錄與推估設定會被備份內容取代。",
        confirmText: "還原",
        cancelText: "取消",
        className: "cycle-confirm"
      });

      if (!approved) return;

      const previousRecords = await state.collection.all();
      const previousSettings = { ...state.settings };

      const result = await global.SafeImport.run({
        prepare: async () => {
          const payload = await global.DataBackup.readJsonFile(file);
          return global.DataBackup.extractData(payload, { allowRaw: false });
        },
        validate: validateBackupData,
        commit: async data => {
          await state.collection.replace(data.records);
          saveSettingsValue(data.settings || DEFAULT_SETTINGS);
          return true;
        },
        rollback: async () => {
          await state.collection.replace(previousRecords);
          saveSettingsValue(previousSettings);
          return true;
        }
      });

      if (!result.ok) {
        console.error(result.error || result.rollbackError);
        status.textContent = result.stage === "prepare"
          ? "備份格式不符合 cycle，沒有覆蓋目前資料。"
          : "還原失敗，已嘗試保留原本資料。";
        return;
      }

      await state.crud.refresh();
      await refreshRecords();
      syncSettingsInputs();
      global.SlowlyCustomFile.reset("#backupFilePicker");
      importButton.disabled = true;
      status.textContent = "備份已還原。";
    });
  }

  async function init() {
    const missing = [
      ["SlowlyCalendar", global.SlowlyCalendar],
      ["CalendarInteraction", global.CalendarInteraction],
      ["FictionStorage", global.FictionStorage],
      ["FictionChange", global.FictionChange],
      ["SlowlyDataCRUD", global.SlowlyDataCRUD],
      ["SlowlyTabs", global.SlowlyTabs],
      ["DataBackup", global.DataBackup],
      ["SafeImport", global.SafeImport],
      ["SlowlyDate", global.SlowlyDate],
      ["SlowlySelect", global.SlowlySelect],
      ["SlowlyCustomFile", global.SlowlyCustomFile],
      ["SlowlyConfirm", global.SlowlyConfirm]
    ].filter(([, value]) => !value);

    if (missing.length) {
      console.error("[cycle] 缺少軍火庫依賴：", missing.map(([name]) => name));
      return;
    }

    initTabs();
    initCalendar();
    initCrud();
    initPrimaryActions();
    initBackup();
    syncSettingsInputs();
    await refreshRecords();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
