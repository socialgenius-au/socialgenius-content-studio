import { useState } from 'react'
import { Sparkles, Send, Check, X } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAICompanion } from '@/contexts/AICompanionContext'

const SUGGESTED_BY_CONTEXT: Record<string, string[]> = {
  Positioning: ['Should speed be a differentiator or supporting proof?', 'Is our warranty claim strong enough to lead with?', 'What would strengthen the Sustainability score?'],
  'Strategic Intelligence': ['What factors may affect this industry over the next 3 years?', 'Which findings are strongest candidates to become proof points?'],
  'Create Hub': ['Give me three non-fear hooks for this outcome.', 'Which angle best fits an Enquiry objective?'],
  'Social Audit': ['What is causing the biggest gap right now?', 'Which dimension has the best effort-to-impact ratio?'],
  'Leads & Sales': ['Why are these enquiries failing to convert?', 'Which lead source is producing the highest-value leads?'],
  'Tasks & Delivery': ['What are we behind on this week?', 'What should be reprioritised before Friday?'],
}

export function AICompanionDrawer() {
  const { isOpen, close, contextLabel, messages, loading, send, applyAction } = useAICompanion()
  const [input, setInput] = useState('')

  const suggestions = SUGGESTED_BY_CONTEXT[contextLabel] ?? ['What should I focus on next?', 'Summarise what\'s changed recently.']

  const handleSend = (text?: string) => {
    const q = (text ?? input).trim()
    if (!q) return
    send(q)
    setInput('')
  }

  return (
    <Sheet open={isOpen} onOpenChange={o => !o && close()}>
      <SheetContent className="flex flex-col p-0">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sg-lime/20 text-sg-forest">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <SheetTitle>AI Companion</SheetTitle>
          </div>
          <SheetDescription>{contextLabel}</SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 px-4">
          <div className="flex flex-col gap-3 py-4">
            {messages.length === 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Suggested questions</p>
                {suggestions.map(s => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-left text-xs text-foreground hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} className={m.role === 'user' ? 'ml-8 rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground' : 'mr-4 rounded-lg bg-muted px-3 py-2 text-xs text-foreground'}>
                <p>{m.content}</p>
                {m.actions && m.actions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.actions.map(a => (
                      <Button
                        key={a.id}
                        size="sm"
                        variant="outline"
                        className="h-6 gap-1 bg-background px-2 text-[11px]"
                        onClick={() => applyAction(m.id, a.id)}
                        disabled={a.label.startsWith('✓')}
                      >
                        {a.label.startsWith('✓') ? <Check className="h-3 w-3" /> : null}
                        {a.label}
                        {a.requiresApproval && !a.label.startsWith('✓') && (
                          <Badge variant="warning" className="ml-1 px-1 py-0 text-[9px]">needs approval</Badge>
                        )}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && <div className="mr-4 w-fit rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Thinking…</div>}
          </div>
        </ScrollArea>

        <SheetFooter className="flex-col items-stretch gap-2">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={`Ask about ${contextLabel}…`}
              className="min-h-[44px]"
            />
            <Button size="icon" onClick={() => handleSend()} disabled={loading || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <button onClick={close} className="flex items-center gap-1 self-end text-[11px] text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" /> Close
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
