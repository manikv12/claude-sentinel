import React, { useState, useRef, useEffect } from 'react'
import { Button } from './button'
import { Card, CardContent } from './card'
import { Calendar, Clock, ChevronLeft, ChevronRight } from 'lucide-react'

interface DatePickerProps {
  value?: string // ISO string
  onChange: (value: string) => void
  minDate?: Date
  className?: string
}

export function DatePicker({ value, onChange, minDate, className }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date>(
    value ? new Date(value) : new Date()
  )
  const [selectedTime, setSelectedTime] = useState<string>(
    value ? (() => {
      const date = new Date(value)
      const hours = date.getHours()
      const minutes = date.getMinutes()
      const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
      return `${hour12.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
    })() : '06:00'
  )
  const [selectedAmPm, setSelectedAmPm] = useState<'AM' | 'PM'>(
    value ? (new Date(value).getHours() >= 12 ? 'PM' : 'AM') : 'AM'
  )
  const [viewDate, setViewDate] = useState<Date>(
    value ? new Date(value) : new Date()
  )
  
  const containerRef = useRef<HTMLDivElement>(null)

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [isOpen])

  const formatDisplayValue = () => {
    if (!value) return 'Select date and time'
    const date = new Date(value)
    return `${date.toLocaleDateString()} at ${date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })}`
  }

  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  }

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay()
  }

  const isDateDisabled = (date: Date) => {
    if (!minDate) return false
    // Compare only the date part, not time
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const minDateOnly = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())
    return dateOnly < minDateOnly
  }

  const handleDateSelect = (day: number) => {
    const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day)
    setSelectedDate(newDate)
    updateDateTime(selectedTime, selectedAmPm)
  }

  const handleTimeChange = (time: string) => {
    setSelectedTime(time)
    updateDateTime(time, selectedAmPm)
  }

  const handleAmPmChange = (ampm: 'AM' | 'PM') => {
    setSelectedAmPm(ampm)
    updateDateTime(selectedTime, ampm)
  }

  const updateDateTime = (time: string, ampm: 'AM' | 'PM') => {
    // Combine date and time with AM/PM
    const newDate = new Date(selectedDate)
    const [hours, minutes] = time.split(':').map(Number)

    // Convert 12-hour format to 24-hour format
    let hour24 = hours
    if (ampm === 'PM' && hours !== 12) {
      hour24 = hours + 12
    } else if (ampm === 'AM' && hours === 12) {
      hour24 = 0
    }

    newDate.setHours(hour24, minutes, 0, 0)
    onChange(newDate.toISOString())
  }

  const navigateMonth = (direction: 'prev' | 'next') => {
    setViewDate(prev => {
      const newDate = new Date(prev)
      if (direction === 'prev') {
        newDate.setMonth(newDate.getMonth() - 1)
      } else {
        newDate.setMonth(newDate.getMonth() + 1)
      }
      return newDate
    })
  }

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(viewDate)
    const firstDay = getFirstDayOfMonth(viewDate)
    const today = new Date()
    const days = []

    // Empty cells for days before the first day of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="w-8 h-8" />)
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), day)
      const isSelected = selectedDate.toDateString() === date.toDateString()
      const isToday = today.toDateString() === date.toDateString()
      const isDisabled = isDateDisabled(date)

      days.push(
        <button
          key={day}
          onClick={() => !isDisabled && handleDateSelect(day)}
          disabled={isDisabled}
          className={`
            w-8 h-8 text-sm rounded-lg transition-all duration-200 font-medium
            ${isSelected 
              ? 'bg-blue-500/80 text-white backdrop-blur-sm shadow-lg border border-blue-400/50' 
              : isToday 
                ? 'bg-white/30 dark:bg-white/20 text-foreground backdrop-blur-sm border border-white/40 dark:border-white/30' 
                : 'hover:bg-white/20 dark:hover:bg-white/15 hover:text-foreground hover:backdrop-blur-sm hover:border hover:border-white/30'
            }
            ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          {day}
        </button>
      )
    }

    return days
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <Button
        type="button"
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full justify-start text-left font-normal"
      >
        <Calendar className="mr-2 h-4 w-4" />
        {formatDisplayValue()}
      </Button>

      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-2 w-80 bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-xl shadow-2xl shadow-black/25">
          <div className="p-4">
            {/* Calendar Header */}
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => navigateMonth('prev')}
                className="w-8 h-8 rounded-lg bg-white/20 dark:bg-white/10 backdrop-blur-sm border border-white/30 dark:border-white/20 hover:bg-white/30 dark:hover:bg-white/20 transition-all duration-200 flex items-center justify-center"
              >
                <ChevronLeft className="h-4 w-4 text-foreground/80" />
              </button>
              <h3 className="font-semibold text-foreground/90 text-center">
                {viewDate.toLocaleDateString('en-US', { 
                  month: 'long', 
                  year: 'numeric' 
                })}
              </h3>
              <button
                type="button"
                onClick={() => navigateMonth('next')}
                className="w-8 h-8 rounded-lg bg-white/20 dark:bg-white/10 backdrop-blur-sm border border-white/30 dark:border-white/20 hover:bg-white/30 dark:hover:bg-white/20 transition-all duration-200 flex items-center justify-center"
              >
                <ChevronRight className="h-4 w-4 text-foreground/80" />
              </button>
            </div>

            {/* Day Labels */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                <div key={day} className="w-8 h-8 text-xs font-medium text-foreground/60 flex items-center justify-center">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1 mb-4">
              {renderCalendar()}
            </div>

            {/* Time Picker */}
            <div className="border-t border-white/20 dark:border-white/10 pt-4">
              <div className="flex items-center space-x-2 mb-3">
                <Clock className="h-4 w-4 text-foreground/70" />
                <label className="text-sm font-medium text-foreground/90">Time</label>
              </div>

              <div className="flex space-x-2">
                {/* Hour Selector */}
                <select
                  value={selectedTime.split(':')[0]}
                  onChange={(e) => {
                    const hour = e.target.value
                    const minute = selectedTime.split(':')[1] || '00'
                    const newTime = `${hour}:${minute}`
                    setSelectedTime(newTime)
                    updateDateTime(newTime, selectedAmPm)
                  }}
                  className="px-3 py-2 border border-white/30 dark:border-white/20 rounded-lg text-sm bg-white/20 dark:bg-white/10 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:bg-white/30 dark:focus:bg-white/20 text-foreground/90"
                >
                  {Array.from({ length: 12 }, (_, i) => {
                    const hour = i + 1
                    return (
                      <option key={hour} value={hour.toString().padStart(2, '0')}>
                        {hour}
                      </option>
                    )
                  })}
                </select>

                {/* Minute Selector */}
                <select
                  value={selectedTime.split(':')[1] || '00'}
                  onChange={(e) => {
                    const hour = selectedTime.split(':')[0] || '12'
                    const minute = e.target.value
                    const newTime = `${hour}:${minute}`
                    setSelectedTime(newTime)
                    updateDateTime(newTime, selectedAmPm)
                  }}
                  className="px-3 py-2 border border-white/30 dark:border-white/20 rounded-lg text-sm bg-white/20 dark:bg-white/10 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:bg-white/30 dark:focus:bg-white/20 text-foreground/90"
                >
                  {Array.from({ length: 60 }, (_, i) => {
                    const minute = i.toString().padStart(2, '0')
                    return (
                      <option key={minute} value={minute}>
                        {minute}
                      </option>
                    )
                  })}
                </select>

                {/* AM/PM Selector */}
                <div className="flex border border-white/30 dark:border-white/20 rounded-lg overflow-hidden bg-white/20 dark:bg-white/10 backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => handleAmPmChange('AM')}
                    className={`px-3 py-2 text-xs font-medium transition-all duration-200 ${
                      selectedAmPm === 'AM'
                        ? 'bg-blue-500/80 text-white shadow-sm'
                        : 'text-foreground/70 hover:bg-white/20 dark:hover:bg-white/15'
                    }`}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAmPmChange('PM')}
                    className={`px-3 py-2 text-xs font-medium transition-all duration-200 ${
                      selectedAmPm === 'PM'
                        ? 'bg-blue-500/80 text-white shadow-sm'
                        : 'text-foreground/70 hover:bg-white/20 dark:hover:bg-white/15'
                    }`}
                  >
                    PM
                  </button>
                </div>
              </div>

              {/* Time Preview */}
              <div className="mt-2 text-xs text-foreground/60">
                {(() => {
                  const [hours, minutes] = selectedTime.split(':').map(Number)
                  let hour24 = hours
                  if (selectedAmPm === 'PM' && hours !== 12) {
                    hour24 = hours + 12
                  } else if (selectedAmPm === 'AM' && hours === 12) {
                    hour24 = 0
                  }
                  return `${hours}:${minutes.toString().padStart(2, '0')} ${selectedAmPm} → ${hour24.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
                })()}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 mt-4 border-t border-white/20 dark:border-white/10 pt-4">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 rounded-lg bg-white/20 dark:bg-white/10 backdrop-blur-sm border border-white/30 dark:border-white/20 hover:bg-white/30 dark:hover:bg-white/20 transition-all duration-200 text-sm font-medium text-foreground/80"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  updateDateTime(selectedTime, selectedAmPm)
                  setIsOpen(false)
                }}
                className="px-4 py-2 rounded-lg bg-blue-500/80 backdrop-blur-sm border border-blue-400/50 hover:bg-blue-500/90 transition-all duration-200 text-sm font-medium text-white shadow-lg"
              >
                Select
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}