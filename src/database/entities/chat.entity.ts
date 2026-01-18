import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';
import { User } from './user.entity';
import { ChatMessage } from './chat-message.entity';

@Entity('chat')
export class Chat {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: number;

  @Column({ name: 'user_id' })
  user_id: number;

  @CreateDateColumn()
  created_at: Date;

  // Relations
  @ManyToOne(() => SurgeryRequest, (request) => request.chats)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;

  @ManyToOne(() => User, (user) => user.chats)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(() => ChatMessage, (message) => message.chat)
  messages: ChatMessage[];
}
