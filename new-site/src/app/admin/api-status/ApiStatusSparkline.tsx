'use client'

import React from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts'

export type SparkPoint = { t: number; v: number | null }

function SparkTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean
  payload?: Array<{ value?: number | null }>
  unit: string
}) {
  if (!active || !payload?.length) return null
  const v = payload[0]?.value
  if (typeof v !== 'number') return null
  return (
    <div className="api-spark-tooltip">
      {v.toLocaleString('en-GB', { maximumFractionDigits: 1 })}
      {unit}
    </div>
  )
}

export function ApiStatusSparkline({
  data,
  color,
  unit = '',
}: {
  data: SparkPoint[]
  color: string
  unit?: string
}) {
  const points = data.filter((p) => typeof p.v === 'number')
  if (points.length < 2) {
    return <p className="api-spark-empty">Collecting samples…</p>
  }
  return (
    <div className="api-spark">
      <ResponsiveContainer width="100%" height={72}>
        <AreaChart data={points} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip content={<SparkTooltip unit={unit} />} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            fill={color}
            fillOpacity={0.18}
            strokeWidth={1.6}
            isAnimationActive={false}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
