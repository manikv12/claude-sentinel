import { useState, useRef, useEffect } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

interface DateRange {
  from: Date | null
  to: Date | null
}

interface DateRangePickerProps {
  value: DateRange
  onChange: (range: DateRange) => void
  placeholder?: string
  className?: string
}

export function DateRangePicker({ value, onChange, placeholder = "Select date range", className = "" }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [hoverDate, setHoverDate] = useState<Date | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const formatDateRange = (range: DateRange) => {
    if (!range.from && !range.to) return placeholder
    if (range.from && !range.to) return range.from.toLocaleDateString()
    if (range.from && range.to) {
      return `${range.from.toLocaleDateString()} - ${range.to.toLocaleDateString()}`
    }
    return placeholder
  }

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startingDayOfWeek = firstDay.getDay()

    const days = []
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null)
    }
    
    // Add all days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day))
    }
    
    return days
  }

  const isDateInRange = (date: Date, range: DateRange, hover: Date | null) => {
    if (!range.from) return false
    if (!range.to && hover) {
      const start = range.from < hover ? range.from : hover
      const end = range.from < hover ? hover : range.from
      return date >= start && date <= end
    }
    if (range.to) {
      return date >= range.from && date <= range.to
    }
    return false
  }

  const isDateSelected = (date: Date, range: DateRange) => {
    return (range.from && date.getTime() === range.from.getTime()) ||
           (range.to && date.getTime() === range.to.getTime())
  }

  const handleDateClick = (date: Date) => {
    if (!value.from || (value.from && value.to)) {
      // Start new selection
      onChange({ from: date, to: null })
    } else {
      // Complete selection
      if (date < value.from) {
        onChange({ from: date, to: value.from })
      } else {
        onChange({ from: value.from, to: date })
      }
      setIsOpen(false)
    }
  }

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => {
      const newMonth = new Date(prev)
      if (direction === 'prev') {
        newMonth.setMonth(prev.getMonth() - 1)
      } else {
        newMonth.setMonth(prev.getMonth() + 1)
      }
      return newMonth
    })
  }

  const days = getDaysInMonth(currentMonth)
  const monthYear = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 rounded-xl text-sm bg-gray-700/60 dark:bg-gray-800/60 backdrop-blur-lg text-gray-200 border border-gray-600/50 dark:border-gray-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-400/50 shadow-inner shadow-black/10 transition-all duration-200 hover:bg-gray-600/60 dark:hover:bg-gray-700/60 flex items-center justify-between"
      >
        <span className={value.from || value.to ? 'text-gray-200' : 'text-gray-400'}>
          {formatDateRange(value)}
        </span>
        <Calendar className="h-4 w-4 text-gray-400" />
      </button>

      {/* Calendar Popup */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 z-50 p-4 rounded-xl bg-gray-800/95 dark:bg-gray-900/95 backdrop-blur-2xl border border-gray-600/50 dark:border-gray-700/50 shadow-2xl shadow-black/40 w-80">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => navigateMonth('prev')}
              className="p-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-600/60 transition-all duration-200"
            >
              <ChevronLeft className="h-4 w-4 text-gray-300" />
            </button>
            
            <h3 className="text-sm font-semibold text-gray-200">
              {monthYear}
            </h3>
            
            <button
              onClick={() => navigateMonth('next')}
              className="p-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-600/60 transition-all duration-200"
            >
              <ChevronRight className="h-4 w-4 text-gray-300" />
            </button>
          </div>

          {/* Days of Week */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center text-xs font-medium text-gray-400 py-1">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((date, index) => {
              if (!date) {
                return <div key={index} className="h-8" />
              }

              const isSelected = isDateSelected(date, value)
              const isInRange = isDateInRange(date, value, hoverDate)
              const isToday = date.toDateString() === new Date().toDateString()

              return (
                <button
                  key={index}
                  onClick={() => handleDateClick(date)}
                  onMouseEnter={() => setHoverDate(date)}
                  onMouseLeave={() => setHoverDate(null)}
                  className={`
                    h-8 rounded-lg text-xs font-medium transition-all duration-200 relative
                    ${isSelected 
                      ? 'bg-blue-600 text-white border border-blue-500' 
                      : isInRange 
                        ? 'bg-blue-600/30 text-gray-200 border border-blue-500/50' 
                        : 'hover:bg-gray-700/60 text-gray-300 border border-transparent'
                    }
                    ${isToday && !isSelected ? 'ring-1 ring-blue-500/60' : ''}
                  `}
                >
                  {date.getDate()}
                  {isToday && !isSelected && (
                    <div className="absolute bottom-0.5 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-blue-500 rounded-full" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Footer with Quick Select */}
          <div className="mt-3 space-y-2">
            {/* Quick Select Buttons */}
            <div className="flex flex-wrap gap-1">
              {[
                { label: 'Today', days: 0 },
                { label: '7D', days: 7 },
                { label: '14D', days: 14 },
                { label: '30D', days: 30 },
                { label: '90D', days: 90 }
              ].map((option) => (
                <button
                  key={option.label}
                  onClick={() => {
                    const today = new Date()
                    if (option.days === 0) {
                      // "Today" - just today
                      onChange({ from: today, to: today })
                    } else {
                      const startDate = new Date()
                      startDate.setDate(today.getDate() - option.days + 1)
                      onChange({ from: startDate, to: today })
                    }
                  }}
                  className="px-2 py-1 text-xs rounded-md bg-gray-600/60 hover:bg-gray-500/60 text-gray-300 border border-gray-500/30 transition-all duration-200"
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/* Selected Days Info */}
            {(value.from || value.to) && (
              <div className="p-2 rounded-lg bg-gray-700/40 border border-gray-600/30">
                <div className="text-xs text-gray-300">
                  {value.from && value.to 
                    ? `Selected: ${Math.ceil((value.to.getTime() - value.from.getTime()) / (1000 * 60 * 60 * 24)) + 1} days`
                    : value.from 
                      ? 'Click another date to complete range'
                      : ''
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}