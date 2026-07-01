export const NIGERIA_TIME_ZONE = 'Africa/Lagos';
export const INSTRUCTOR_ATTENDANCE_LOCK_HOUR = 18; // 4:00 PM Nigerian time (UTC+1) in 24-hour format
export const INSTRUCTOR_ATTENDANCE_LOCK_MINUTE = 30;

const MS_PER_MINUTE = 60 * 1000;

const nigeriaDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: NIGERIA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

const nigeriaDateLabelFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NIGERIA_TIME_ZONE,
  dateStyle: 'medium'
});

const nigeriaTimeLabelFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NIGERIA_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});

function formatToPartMap(formatter, value) {
  return formatter.formatToParts(value).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
}

export function getNigeriaNowParts(now = new Date()) {
  const parts = formatToPartMap(nigeriaDateTimeFormatter, now);
  const year = parts.year || '';
  const month = parts.month || '';
  const day = parts.day || '';
  const hourNumber = Number(parts.hour || 0);
  const minuteNumber = Number(parts.minute || 0);

  return {
    year,
    month,
    day,
    hourNumber,
    minuteNumber,
    dateKey: `${year}-${month}-${day}`,
    dateLabel: nigeriaDateLabelFormatter.format(now),
    timeLabel: nigeriaTimeLabelFormatter.format(now)
  };
}

export function getNigeriaDateKey(value = new Date()) {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }

  const dateValue = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateValue.getTime())) return '';

  return getNigeriaNowParts(dateValue).dateKey;
}

export function isInstructorAttendanceLocked(now = new Date()) {
  return getNigeriaNowParts(now).hourNumber >= INSTRUCTOR_ATTENDANCE_LOCK_HOUR;
}

export function getInstructorAttendanceLockState(now = new Date()) {
  const parts = getNigeriaNowParts(now);
  const isLocked = isInstructorAttendanceLocked(now);

  return {
    isLocked,
    currentDateKey: parts.dateKey,
    currentDateLabel: parts.dateLabel,
    currentTimeLabel: parts.timeLabel,
    cutoffHour: INSTRUCTOR_ATTENDANCE_LOCK_HOUR,
    cutoffMinute: INSTRUCTOR_ATTENDANCE_LOCK_MINUTE,
    cutoffLabel: `6:30 PM ${NIGERIA_TIME_ZONE}`,
    statusMessage: isLocked
      ? `Attendance is locked for ${parts.dateLabel}. Instructors cannot mark or change attendance after 6:30 PM Nigerian time.`
      : `Attendance for ${parts.dateLabel} will lock automatically at 6:30 PM Nigerian time.`
  };
}

export function getMillisecondsUntilNextMinute(now = new Date()) {
  return MS_PER_MINUTE - ((now.getSeconds() * 1000) + now.getMilliseconds());
}

export function buildInstructorAttendanceLockError(now = new Date()) {
  const state = getInstructorAttendanceLockState(now);
  return new Error(`Attendance is locked for today after 6:30 PM ${NIGERIA_TIME_ZONE}. Current Nigeria time: ${state.currentTimeLabel}.`);
}
