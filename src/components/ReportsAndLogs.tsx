import React, { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Reports } from './Reports'
import { LogViewer } from './LogViewer'

export function ReportsAndLogs() {
  const [activeTab, setActiveTab] = useState('reports')

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">Reports & Logs</h2>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="reports">Usage Reports</TabsTrigger>
          <TabsTrigger value="logs">Activity Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="space-y-6">
          <Reports />
        </TabsContent>

        <TabsContent value="logs" className="space-y-6">
          <LogViewer />
        </TabsContent>
      </Tabs>
    </div>
  )
}