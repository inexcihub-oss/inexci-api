import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Chat } from './chat.entity';
import { User } from './user.entity';

@Entity('chat_message')
export class ChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'chat_id' })
  chat_id: number;

  @Column({ name: 'sent_by' })
  sent_by: number;

  @Column({ type: 'boolean', default: false })
  read: boolean;

  @Column({ type: 'text' })
  message: string;

  @CreateDateColumn()
  created_at: Date;

  // Relations
  @ManyToOne(() => Chat, (chat) => chat.messages)
  @JoinColumn({ name: 'chat_id' })
  chat: Chat;

  @ManyToOne(() => User, (user) => user.sent_messages)
  @JoinColumn({ name: 'sent_by' })
  sender: User;
}
