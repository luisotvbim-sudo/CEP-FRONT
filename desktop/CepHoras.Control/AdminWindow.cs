using System.Windows;
using System.Windows.Controls;

namespace CepHoras.Control;

internal sealed class AdminWindow : Window
{
    private bool operationRunning;
    private readonly TextBlock status = new()
    {
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, 16, 0, 0)
    };

    internal AdminWindow()
    {
        Title = "CEP Horas — recuperação administrativa";
        Width = 640;
        SizeToContent = SizeToContent.Height;
        ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        var panel = new StackPanel { Margin = new Thickness(28) };
        Content = panel;
        panel.Children.Add(new TextBlock
        {
            Text = "Controle local de energia",
            FontSize = 24,
            FontWeight = FontWeights.SemiBold
        });
        panel.Children.Add(new TextBlock
        {
            Margin = new Thickness(0, 16, 0, 16),
            TextWrapping = TextWrapping.Wrap,
            Text = "O instalador ativa automaticamente as restrições dos controles de energia do Windows e preserva os direitos originais da conta. O CEP Horas consulta a API e o serviço local executa Desligar, Reiniciar ou Hibernar. A contingência exige falha de transporte confirmada pelo aplicativo.\n\nEsta ferramenta é exclusiva da TI e restaura as permissões e políticas existentes antes da instalação. Administradores e SYSTEM permanecem como recuperação. Sessões criadas pela versão antiga precisam sair e entrar no Windows uma vez para reconhecer os direitos restaurados."
        });
        var verify = new Button
        {
            Content = "Verificar serviço e política",
            Padding = new Thickness(12, 9, 12, 9)
        };
        verify.Click += async (_, _) =>
        {
            if (operationRunning) return;
            operationRunning = true;
            try
            {
                verify.IsEnabled = false;
                status.Text = await Task.Run(AdministrativeRecovery.Status);
            }
            catch (Exception error) { status.Text = "Falha na verificação: " + error.Message; }
            finally { verify.IsEnabled = true; operationRunning = false; }
        };
        panel.Children.Add(verify);
        var restore = new Button
        {
            Content = "Restaurar configurações anteriores (TI)",
            Padding = new Thickness(12, 9, 12, 9),
            Margin = new Thickness(0, 10, 0, 0)
        };
        restore.Click += async (_, _) =>
        {
            if (operationRunning) return;
            if (MessageBox.Show(
                    "Parar o serviço CEP Horas e restaurar as permissões e configurações salvas antes da instalação? A supervisão permanecerá parada até a TI retomá-la.",
                    Title,
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            operationRunning = true;
            try
            {
                restore.IsEnabled = false;
                verify.IsEnabled = false;
                await Task.Run(() => AdministrativeRecovery.Installed().Restore());
                status.Text = "Serviço parado e configurações restauradas. Faça novo logon dos usuários. A TI pode retomar o serviço quando concluir a recuperação.";
            }
            catch (Exception error)
            {
                status.Text = "A restauração não concluiu. Preserve a instalação e o backup: " + error.Message;
            }
            finally { restore.IsEnabled = true; verify.IsEnabled = true; operationRunning = false; }
        };
        panel.Children.Add(restore);
        panel.Children.Add(status);
    }
}
