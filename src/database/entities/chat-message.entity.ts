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
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'chat_id' })
  chat_id: string;

  @Column({ name: 'sender_id' })
  sender_id: string;

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
  @JoinColumn({ name: 'sender_id' })
  sender: User;
}
